import { CreateMLCEngine } from "@mlc-ai/web-llm";

/* ---------------- Sentence-by-Sentence Parallel Detector ---------------- */
class SensitiveTextDetector {
  constructor() {
    this.isInitialized = false;
    this.attachedInputs = new WeakSet();
    this.activeOverlays = new Map();
    this.processingQueue = new Map();
    this.lastProcessedText = new WeakMap();
    this.engine = null;
    this.isMainTab = false;
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.statusIcon = null;
    this.isProcessing = false;
    
    // Use BroadcastChannel for cross-tab communication
    this.channel = new BroadcastChannel('webllm_shared_engine');
    this.channel.addEventListener('message', (event) => {
      this.handleChannelMessage(event.data);
    });
    
    // Simple binary classification prompt
    this.classificationPrompt = `Analyze this sentence for sensitive information. Respond with ONLY "true" or "false".

Sensitive information includes:
- Personal names, addresses, phone numbers, email addresses
- Passwords, API keys, tokens, credentials
- Credit card numbers, bank account numbers, SSN
- Personal confessions, secrets, private thoughts
- Financial details, salary information

Examples:
"My name is John Smith" → true
"My password is abc123" → true  
"I confess I cheated on the test" → true
"The weather is nice today" → false
"Let's meet at the coffee shop" → false
"I love pizza" → false

Sentence: `;
  }

  // Create and manage the status icon
  createStatusIcon() {
    if (this.statusIcon) return;

    // Create icon container
    this.statusIcon = document.createElement('div');
    this.statusIcon.id = 'sensitive-text-detector-icon';
    this.statusIcon.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background-color: #dc2626;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 24px;
      font-weight: bold;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
      user-select: none;
    `;

    // Create the "G" text
    const gText = document.createElement('span');
    gText.textContent = 's';
    gText.style.cssText = `
      position: relative;
      z-index: 2;
    `;
    this.statusIcon.appendChild(gText);

    // Create spinner overlay (initially hidden)
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 30px;
      height: 30px;
      margin: -15px 0 0 -15px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 3;
    `;
    this.statusIcon.appendChild(spinner);

    // Add CSS keyframes for spinner animation
    if (!document.querySelector('#detector-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'detector-spinner-styles';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        #sensitive-text-detector-icon:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
        }
      `;
      document.head.appendChild(style);
    }

    // Add click handler for status info
    this.statusIcon.addEventListener('click', () => {
      this.showStatusTooltip();
    });

    // Add to page
    document.body.appendChild(this.statusIcon);

    // Set initial status
    this.updateIconStatus('not-ready');
  }

  updateIconStatus(status) {
    if (!this.statusIcon) return;

    const spinner = this.statusIcon.querySelector('.spinner');
    const gText = this.statusIcon.querySelector('span');

    switch (status) {
      case 'not-ready':
        this.statusIcon.style.backgroundColor = '#dc2626'; // Red
        this.statusIcon.title = '🔴 AI Engine Not Ready - Loading...';
        spinner.style.opacity = '0';
        gText.style.opacity = '1';
        break;
        
      case 'loading':
        this.statusIcon.style.backgroundColor = '#f59e0b'; // Orange
        this.statusIcon.title = '🟡 AI Engine Loading...';
        spinner.style.opacity = '0';
        gText.style.opacity = '1';
        break;
        
      case 'ready':
        this.statusIcon.style.backgroundColor = '#059669'; // Green
        this.statusIcon.title = '🟢 AI Engine Ready - Monitoring Text';
        spinner.style.opacity = '0';
        gText.style.opacity = '1';
        break;
        
      case 'processing':
        // Keep current background color but show spinner
        this.statusIcon.title = '⚡ Processing Text...';
        spinner.style.opacity = '1';
        gText.style.opacity = '0.3';
        break;
        
      case 'error':
        this.statusIcon.style.backgroundColor = '#7c2d12'; // Dark red
        this.statusIcon.title = '❌ AI Engine Error';
        spinner.style.opacity = '0';
        gText.style.opacity = '1';
        break;
    }
  }

  setProcessingState(isProcessing) {
    this.isProcessing = isProcessing;
    if (isProcessing) {
      this.updateIconStatus('processing');
    } else {
      // Return to previous state based on engine status
      if (this.isInitialized) {
        this.updateIconStatus('ready');
      } else {
        this.updateIconStatus('not-ready');
      }
    }
  }

  showStatusTooltip() {
    // Create temporary tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10001;
      max-width: 300px;
      line-height: 1.4;
    `;

    let statusText = '';
    if (!this.isInitialized && !this.isMainTab) {
      statusText = '🔴 Engine Not Ready\nWaiting for AI model to load...';
    } else if (!this.isInitialized && this.isMainTab) {
      statusText = '🟡 Loading AI Model\nThis may take a few moments...';
    } else if (this.isProcessing) {
      statusText = '⚡ Processing Text\nAnalyzing for sensitive content...';
    } else {
      statusText = '🟢 Ready & Monitoring\nAI engine is active and watching for sensitive text';
    }

    tooltip.textContent = statusText;
    document.body.appendChild(tooltip);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.remove();
      }
    }, 3000);
  }

  async initialize() {
    // Create icon immediately
    this.createStatusIcon();
    this.updateIconStatus('not-ready');
    
    this.requestEngineStatus();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (!this.isInitialized) {
      await this.becomeMainTab();
    }
  }

  requestEngineStatus() {
    this.channel.postMessage({
      type: 'engine_status_request',
      from: this.getTabId()
    });
  }

  async becomeMainTab() {
    console.log("🚀 Becoming main tab, loading WebLLM engine...");
    this.isMainTab = true;
    this.updateIconStatus('loading');
    
    try {
      this.engine = await CreateMLCEngine(
        "Phi-3.5-mini-instruct-q4f32_1-MLC-1k",
        {
          initProgressCallback: (progress) => {
            const percentage = Math.round(progress.progress * 100);
            console.log(`Loading model: ${percentage}%`);
            this.updateIconStatus('loading');
            if (this.statusIcon) {
              this.statusIcon.title = `🟡 Loading AI Model: ${percentage}%`;
            }
            this.channel.postMessage({
              type: 'loading_progress',
              progress: progress.progress
            });
          }
        }
      );
      
      this.isInitialized = true;
      this.updateIconStatus('ready');
      console.log("✅ WebLLM engine loaded successfully");
      
      this.channel.postMessage({
        type: 'engine_ready',
        mainTab: this.getTabId()
      });
      
      this.processWaitingInputs();
      
    } catch (error) {
      console.error("❌ Failed to load engine:", error);
      this.updateIconStatus('error');
      this.channel.postMessage({
        type: 'engine_error',
        error: error.message
      });
    }
  }

  getTabId() {
    if (!this.tabId) {
      this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return this.tabId;
  }

  handleChannelMessage(message) {
    switch (message.type) {
      case 'engine_status_request':
        if (this.isMainTab && this.isInitialized) {
          this.channel.postMessage({
            type: 'engine_ready',
            mainTab: this.getTabId()
          });
        }
        break;
        
      case 'engine_ready':
        if (message.mainTab !== this.getTabId()) {
          console.log("✅ Connected to shared engine from another tab");
          this.isInitialized = true;
          this.updateIconStatus('ready');
          this.processWaitingInputs();
        }
        break;
        
      case 'chat_request':
        if (this.isMainTab && this.engine) {
          this.handleRemoteRequest(message);
        }
        break;
        
      case 'chat_response':
        this.handleRemoteResponse(message);
        break;
        
      case 'engine_error':
        console.error("Engine error from main tab:", message.error);
        this.updateIconStatus('error');
        break;
        
      case 'loading_progress':
        const percentage = Math.round(message.progress * 100);
        console.log(`Model loading: ${percentage}%`);
        if (this.statusIcon && !this.isMainTab) {
          this.statusIcon.title = `🟡 Loading AI Model: ${percentage}%`;
        }
        break;
    }
  }

  async handleRemoteRequest(message) {
    try {
      const response = await this.engine.chat.completions.create(message.data);
      
      this.channel.postMessage({
        type: 'chat_response',
        requestId: message.requestId,
        from: message.from,
        data: response
      });
      
    } catch (error) {
      this.channel.postMessage({
        type: 'chat_response',
        requestId: message.requestId,
        from: message.from,
        error: error.message
      });
    }
  }

  handleRemoteResponse(message) {
    if (message.from === this.getTabId() && this.pendingMessages.has(message.requestId)) {
      const { resolve, reject } = this.pendingMessages.get(message.requestId);
      this.pendingMessages.delete(message.requestId);
      
      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.data);
      }
    }
  }

  async sendChatRequest(data) {
    if (this.isMainTab && this.engine) {
      return await this.engine.chat.completions.create(data);
    } else {
      return new Promise((resolve, reject) => {
        const requestId = ++this.messageId;
        
        this.pendingMessages.set(requestId, { resolve, reject });
        
        this.channel.postMessage({
          type: 'chat_request',
          requestId,
          from: this.getTabId(),
          data
        });
        
        setTimeout(() => {
          if (this.pendingMessages.has(requestId)) {
            this.pendingMessages.delete(requestId);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    }
  }

  // Split text into sentences with positions
  splitIntoSentences(text) {
    const sentences = [];
    
    // More comprehensive sentence splitting
    const sentenceRegex = /[.!?]+(?:\s+|$)/g;
    let lastEnd = 0;
    let match;
    
    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentenceEnd = match.index + match[0].length;
      const sentence = text.slice(lastEnd, sentenceEnd).trim();
      
      if (sentence.length > 0) {
        sentences.push({
          text: sentence,
          start: lastEnd,
          end: sentenceEnd
        });
      }
      
      lastEnd = sentenceEnd;
    }
    
    // Handle remaining text if no final punctuation
    if (lastEnd < text.length) {
      const remaining = text.slice(lastEnd).trim();
      if (remaining.length > 0) {
        sentences.push({
          text: remaining,
          start: lastEnd,
          end: text.length
        });
      }
    }
    
    return sentences;
  }

  // Classify a single sentence
  async classifySentence(sentence) {
    try {
      const response = await this.sendChatRequest({
        messages: [
          { role: "user", content: this.classificationPrompt + sentence }
        ],
        temperature: 0.0,
        max_tokens: 10, // Very short response needed
        stop: ["\n", " "] // Stop at first word
      });
      
      const result = response.choices[0].message.content.trim().toLowerCase();
      console.log(`Sentence: "${sentence}" → ${result}`);
      
      // Parse true/false response
      return result.includes('true');
      
    } catch (error) {
      console.error("Classification error:", error);
      return false; // Default to not sensitive on error
    }
  }

  // Process sentences with real-time highlighting
  async processSentencesWithRealTimeHighlighting(sentences, inputDiv, batchSize = 3) {
    const allResults = [];
    let currentSensitiveRanges = [];
    
    for (let i = 0; i < sentences.length; i += batchSize) {
      const batch = sentences.slice(i, i + batchSize);
      
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(sentences.length/batchSize)}: ${batch.length} sentences`);
      
      // Process batch in parallel with individual callbacks
      const batchPromises = batch.map(async (sentenceObj) => {
        try {
          const isSensitive = await this.classifySentence(sentenceObj.text);
          const result = {
            ...sentenceObj,
            isSensitive
          };
          
          // Immediately highlight if sensitive
          if (isSensitive) {
            console.log(`🚨 Real-time highlight: "${sentenceObj.text}"`);
            currentSensitiveRanges.push({
              start: sentenceObj.start,
              end: sentenceObj.end,
              type: 'sensitive',
              text: sentenceObj.text
            });
            
            // Update highlight overlay immediately
            this.createHighlightOverlay(inputDiv, [...currentSensitiveRanges]);
            
            // Update border and tooltip
            inputDiv.style.border = "2px solid red";
            inputDiv.title = `⚠️ ${currentSensitiveRanges.length} sensitive sentence(s) detected`;
          }
          
          return result;
        } catch (error) {
          console.error("Error processing sentence:", sentenceObj.text, error);
          return {
            ...sentenceObj,
            isSensitive: false
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults);
      
      // Small delay between batches to prevent overwhelming
      if (i + batchSize < sentences.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return allResults;
  }

  async analyzeBulkText(text, inputDiv) {
    try {
      console.log(`🔍 Analyzing text: "${text.substring(0, 50)}..." (${text.length} chars)`);
      
      // Split into sentences
      const sentences = this.splitIntoSentences(text);
      console.log(`Split into ${sentences.length} sentences:`, sentences.map(s => s.text));
      
      if (sentences.length === 0) {
        return [];
      }
      
      // Clear existing highlights before starting
      this.removeOverlaysForInput(inputDiv);
      inputDiv.style.border = "";
      inputDiv.title = "";
      
      // Process with real-time highlighting
      const results = await this.processSentencesWithRealTimeHighlighting(sentences, inputDiv, 3);
      
      // Filter to only sensitive sentences for final result
      const sensitiveSentences = results.filter(s => s.isSensitive);
      
      console.log(`Final result: ${sensitiveSentences.length} sensitive sentences`);
      
      return sensitiveSentences.map(s => ({
        start: s.start,
        end: s.end,
        type: 'sensitive',
        text: s.text
      }));
      
    } catch (error) {
      console.error("Analysis error:", error);
      return [];
    }
  }

  processWaitingInputs() {
    const inputDiv = document.querySelector("#ask-input");
    if (inputDiv && this.attachedInputs.has(inputDiv)) {
      this.processInput(inputDiv);
    }
  }

  // Create overlay highlighting full sentences
  createHighlightOverlay(inputDiv, sensitiveRanges) {
    this.removeOverlaysForInput(inputDiv);
    
    if (sensitiveRanges.length === 0) return;

    console.log("Creating sentence highlights:", sensitiveRanges);
    
    const text = inputDiv.textContent || inputDiv.innerText || inputDiv.value || '';
    
    const rect = inputDiv.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(inputDiv);
    
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      top: ${rect.top + window.scrollY}px;
      left: ${rect.left + window.scrollX}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 1000;
      font-family: ${computedStyle.fontFamily};
      font-size: ${computedStyle.fontSize};
      font-weight: ${computedStyle.fontWeight};
      line-height: ${computedStyle.lineHeight};
      letter-spacing: ${computedStyle.letterSpacing};
      padding: ${computedStyle.padding};
      margin: ${computedStyle.margin};
      border: ${computedStyle.border};
      box-sizing: ${computedStyle.boxSizing};
      white-space: ${computedStyle.whiteSpace};
      word-wrap: ${computedStyle.wordWrap};
      word-break: ${computedStyle.wordBreak};
      overflow: hidden;
      color: transparent;
      background: transparent;
      text-align: ${computedStyle.textAlign};
    `;

    // Sort ranges by position
    const sortedRanges = [...sensitiveRanges].sort((a, b) => a.start - b.start);

    // Build highlighted HTML
    let highlightedHTML = '';
    let lastIndex = 0;
    
    sortedRanges.forEach(range => {
      // Add text before highlight
      if (lastIndex < range.start) {
        const beforeText = text.slice(lastIndex, range.start);
        highlightedHTML += `<span>${this.escapeHtml(beforeText)}</span>`;
      }
      
      // Add highlighted sentence
      const sentenceText = text.slice(range.start, range.end);
      
      highlightedHTML += `<span style="background-color: rgba(255, 0, 0, 0.3); border-radius: 3px; padding: 2px;" title="⚠️ Sensitive sentence detected">${this.escapeHtml(sentenceText)}</span>`;
      
      console.log(`Highlighting sentence: "${sentenceText}" at ${range.start}-${range.end}`);
      lastIndex = range.end;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      highlightedHTML += `<span>${this.escapeHtml(remainingText)}</span>`;
    }

    overlay.innerHTML = highlightedHTML;
    document.body.appendChild(overlay);
    
    const overlayId = `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.activeOverlays.set(overlayId, overlay);
    inputDiv.dataset.overlayId = overlayId;

    // Position updates
    const updatePosition = () => {
      if (!overlay.parentNode || !document.body.contains(inputDiv)) {
        this.removeOverlaysForInput(inputDiv);
        return;
      }
      const newRect = inputDiv.getBoundingClientRect();
      overlay.style.top = `${newRect.top + window.scrollY}px`;
      overlay.style.left = `${newRect.left + window.scrollX}px`;
      overlay.style.width = `${newRect.width}px`;
      overlay.style.height = `${newRect.height}px`;
    };

    let updateTimer;
    const throttledUpdate = () => {
      if (updateTimer) return;
      updateTimer = setTimeout(() => {
        updatePosition();
        updateTimer = null;
      }, 16);
    };

    const scrollListener = throttledUpdate;
    const resizeListener = throttledUpdate;
    
    window.addEventListener('scroll', scrollListener, { passive: true });
    window.addEventListener('resize', resizeListener, { passive: true });
    
    overlay.cleanup = () => {
      window.removeEventListener('scroll', scrollListener);
      window.removeEventListener('resize', resizeListener);
    };
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  removeOverlaysForInput(inputDiv) {
    const overlayId = inputDiv.dataset.overlayId;
    if (overlayId) {
      const overlay = this.activeOverlays.get(overlayId);
      if (overlay?.parentNode) {
        if (overlay.cleanup) {
          overlay.cleanup();
        }
        overlay.remove();
      }
      this.activeOverlays.delete(overlayId);
      delete inputDiv.dataset.overlayId;
    }
  }

  async processInput(inputDiv) {
    if (!this.isInitialized) {
      console.warn("⚠️ Engine not ready yet");
      return;
    }
    
    const text = (inputDiv.textContent || inputDiv.innerText || inputDiv.value || '').trim();
    
    if (!text) {
      this.removeOverlaysForInput(inputDiv);
      inputDiv.style.border = "";
      inputDiv.title = "";
      return;
    }
    
    // Check cache
    const lastText = this.lastProcessedText.get(inputDiv);
    if (lastText === text) {
      console.log("Text unchanged, skipping processing");
      return;
    }
    
    const processingKey = `${inputDiv.dataset.detectorId || 'default'}_${this.hashCode(text)}`;
    if (this.processingQueue.has(processingKey)) {
      console.log("Already processing this text, skipping");
      return;
    }
    
    this.processingQueue.set(processingKey, true);
    
    try {
      console.log("🔍 Processing text with real-time sentence analysis");
      
      // Set processing state (show spinner)
      this.setProcessingState(true);
      
      // Pass inputDiv to enable real-time highlighting
      const sensitiveRanges = await this.analyzeBulkText(text, inputDiv);
      
      // Final update (this might be redundant since real-time highlighting already happened)
      if (sensitiveRanges.length > 0) {
        console.log(`🚨 Final: ${sensitiveRanges.length} sensitive sentences total`);
        // The highlighting and border should already be set by real-time updates
      } else {
        console.log("✅ No sensitive content found");
        inputDiv.style.border = "";
        inputDiv.title = "";
        this.removeOverlaysForInput(inputDiv);
      }
      
      this.lastProcessedText.set(inputDiv, text);
      
    } catch (error) {
      console.error("❌ Processing error:", error);
    } finally {
      this.processingQueue.delete(processingKey);
      // Clear processing state (hide spinner)
      this.setProcessingState(false);
    }
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  attachToInput(inputDiv) {
    if (this.attachedInputs.has(inputDiv)) {
      console.log("Input already attached, skipping");
      return;
    }
    
    this.attachedInputs.add(inputDiv);
    console.log("✅ Attaching to input element");
    
    if (!inputDiv.dataset.detectorId) {
      inputDiv.dataset.detectorId = `input_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    
    let debounceTimer;
    const debounceDelay = 1500; // Faster response for sentence classification
    
    const processHandler = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.processInput(inputDiv);
      }, debounceDelay);
    };

    const events = ['input', 'paste', 'keyup', 'change'];
    events.forEach(eventType => {
      inputDiv.addEventListener(eventType, processHandler);
    });
    
    inputDiv.addEventListener("paste", () => {
      this.lastProcessedText.delete(inputDiv);
      this.removeOverlaysForInput(inputDiv);
      setTimeout(() => {
        clearTimeout(debounceTimer);
        this.processInput(inputDiv);
      }, 300);
    });
    
    inputDiv.addEventListener("keydown", (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete' || 
          e.key === 'Enter' || e.ctrlKey || e.metaKey) {
        this.lastProcessedText.delete(inputDiv);
        this.removeOverlaysForInput(inputDiv);
        processHandler();
      }
    });
    
    inputDiv.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      this.processInput(inputDiv);
    });
    
    inputDiv.addEventListener("input", () => {
      const text = (inputDiv.textContent || inputDiv.innerText || inputDiv.value || '').trim();
      if (!text) {
        this.lastProcessedText.delete(inputDiv);
        this.removeOverlaysForInput(inputDiv);
        inputDiv.style.border = "";
        inputDiv.title = "";
      } else {
        const lastText = this.lastProcessedText.get(inputDiv);
        if (lastText && lastText !== text) {
          this.removeOverlaysForInput(inputDiv);
        }
      }
    });

    if (this.isInitialized) {
      console.log("Engine ready, processing existing text");
      setTimeout(() => this.processInput(inputDiv), 200);
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === inputDiv || (node.nodeType === 1 && node.contains(inputDiv))) {
            console.log("Input element removed, cleaning up");
            this.removeOverlaysForInput(inputDiv);
            this.attachedInputs.delete(inputDiv);
            this.lastProcessedText.delete(inputDiv);
            observer.disconnect();
          }
        });
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    inputDiv.detectorObserver = observer;
  }

  startMonitoring() {
    console.log("🔍 Starting sentence-by-sentence monitoring");
    
    const observer = new MutationObserver(() => {
      const inputDiv = document.querySelector("#ask-input");
      if (inputDiv && !this.attachedInputs.has(inputDiv)) {
        console.log("✅ Found #ask-input element");
        this.attachToInput(inputDiv);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    const inputDiv = document.querySelector("#ask-input");
    if (inputDiv) {
      console.log("✅ Found existing #ask-input element");
      this.attachToInput(inputDiv);
    } else {
      console.log("ℹ️ No #ask-input found yet, will monitor for it");
    }
  }
}

/* ---------------- Bootstrap ---------------- */
(async () => {
  console.log("🚀 Loading sentence-by-sentence detector...");
  
  const detector = new SensitiveTextDetector();
  await detector.initialize();
  detector.startMonitoring();
  
  console.log("✅ Sentence detector ready and monitoring");
})();