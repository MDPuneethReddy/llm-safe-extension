import { CreateMLCEngine } from "@mlc-ai/web-llm";

/* ---------------- Bug-Fixed Shared Engine via BroadcastChannel ---------------- */
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
    
    // Use BroadcastChannel for cross-tab communication
    this.channel = new BroadcastChannel('webllm_shared_engine');
    this.channel.addEventListener('message', (event) => {
      this.handleChannelMessage(event.data);
    });
    
    this.classificationPrompt = `Find sensitive information. Reply ONLY with JSON array: [{"start":0,"end":10,"type":"auth"}]

Types: "personal","financial","auth","confession"
Empty: []

Text: `;
  }

  async initialize() {
    // Check if another tab already has the engine
    this.requestEngineStatus();
    
    // Wait a bit to see if we get a response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (!this.isInitialized) {
      // No other tab has the engine, so we become the main tab
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
    
    try {
      this.engine = await CreateMLCEngine(
        "Phi-3.5-mini-instruct-q4f32_1-MLC-1k",
        {
          initProgressCallback: (progress) => {
            console.log(`Loading model: ${Math.round(progress.progress * 100)}%`);
            
            // Broadcast progress to other tabs
            this.channel.postMessage({
              type: 'loading_progress',
              progress: progress.progress
            });
          }
        }
      );
      
      this.isInitialized = true;
      console.log("✅ WebLLM engine loaded successfully");
      
      // Notify other tabs that engine is ready
      this.channel.postMessage({
        type: 'engine_ready',
        mainTab: this.getTabId()
      });
      
      this.processWaitingInputs();
      
    } catch (error) {
      console.error("❌ Failed to load engine:", error);
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
        break;
        
      case 'loading_progress':
        console.log(`Model loading: ${Math.round(message.progress * 100)}%`);
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
      // Direct call if we have the engine
      return await this.engine.chat.completions.create(data);
    } else {
      // Send request to main tab via BroadcastChannel
      return new Promise((resolve, reject) => {
        const requestId = ++this.messageId;
        
        this.pendingMessages.set(requestId, { resolve, reject });
        
        this.channel.postMessage({
          type: 'chat_request',
          requestId,
          from: this.getTabId(),
          data
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.pendingMessages.has(requestId)) {
            this.pendingMessages.delete(requestId);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    }
  }

  async analyzeBulkText(text) {
    try {
      const response = await this.sendChatRequest({
        messages: [
          { role: "user", content: this.classificationPrompt + text }
        ],
        temperature: 0.0,
        max_tokens: 200
      });
      
      const result = response.choices[0].message.content.trim();
      console.log("Engine Response:", result);
      
      // Parse response
      try {
        let cleanResult = result.trim();
        if (cleanResult.startsWith('```json')) {
          cleanResult = cleanResult.replace(/```json\s*/, '').replace(/```.*$/, '').trim();
        } else if (cleanResult.startsWith('```')) {
          cleanResult = cleanResult.replace(/```\s*/, '').replace(/```.*$/, '').trim();
        }
        
        const jsonMatch = cleanResult.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          cleanResult = jsonMatch[0];
        }
        
        const ranges = JSON.parse(cleanResult);
        return Array.isArray(ranges) ? ranges : [];
      } catch (parseError) {
        console.warn("Failed to parse response:", result);
        return this.extractRangesFromText(result);
      }
      
    } catch (error) {
      console.error("Analysis error:", error);
      return [];
    }
  }

  extractRangesFromText(response) {
    const ranges = [];
    const rangePattern = /"start"\s*:\s*(\d+).*?"end"\s*:\s*(\d+).*?"type"\s*:\s*"(\w+)"/g;
    let match;
    
    while ((match = rangePattern.exec(response)) !== null) {
      ranges.push({
        start: parseInt(match[1]),
        end: parseInt(match[2]),
        type: match[3]
      });
    }
    
    return ranges;
  }

  processWaitingInputs() {
    const inputDiv = document.querySelector("#ask-input");
    if (inputDiv && this.attachedInputs.has(inputDiv)) {
      // Process immediately if there's existing text
      this.processInput(inputDiv);
    }
  }

  chunkText(text, maxChunkSize = 500) {
    if (text.length <= maxChunkSize) {
      return [{ text, offset: 0 }];
    }
    
    const chunks = [];
    let offset = 0;
    
    while (offset < text.length) {
      let chunkEnd = offset + maxChunkSize;
      
      if (chunkEnd < text.length) {
        const lastPeriod = text.lastIndexOf('.', chunkEnd);
        const lastExclaim = text.lastIndexOf('!', chunkEnd);
        const lastQuestion = text.lastIndexOf('?', chunkEnd);
        const lastBreak = Math.max(lastPeriod, lastExclaim, lastQuestion);
        
        if (lastBreak > offset + 100) {
          chunkEnd = lastBreak + 1;
        }
      }
      
      chunks.push({
        text: text.slice(offset, chunkEnd),
        offset
      });
      
      offset = chunkEnd;
    }
    
    return chunks;
  }

  // Fixed overlay creation with better highlighting
  createHighlightOverlay(inputDiv, sensitiveRanges) {
    this.removeOverlaysForInput(inputDiv);
    
    if (sensitiveRanges.length === 0) return;

    console.log("Creating highlight overlay with ranges:", sensitiveRanges);
    
    const text = inputDiv.textContent || inputDiv.innerText || '';
    const rect = inputDiv.getBoundingClientRect();
    
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
      font-family: ${window.getComputedStyle(inputDiv).fontFamily};
      font-size: ${window.getComputedStyle(inputDiv).fontSize};
      line-height: ${window.getComputedStyle(inputDiv).lineHeight};
      padding: ${window.getComputedStyle(inputDiv).padding};
      margin: ${window.getComputedStyle(inputDiv).margin};
      border: ${window.getComputedStyle(inputDiv).border};
      box-sizing: border-box;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow: hidden;
      color: transparent;
      background: transparent;
    `;

    // Sort and merge overlapping ranges
    const sortedRanges = [...sensitiveRanges].sort((a, b) => a.start - b.start);
    const mergedRanges = [];
    
    sortedRanges.forEach(range => {
      if (mergedRanges.length === 0 || mergedRanges[mergedRanges.length - 1].end <= range.start) {
        mergedRanges.push({ ...range });
      } else {
        mergedRanges[mergedRanges.length - 1].end = Math.max(mergedRanges[mergedRanges.length - 1].end, range.end);
      }
    });

    console.log("Merged ranges:", mergedRanges);

    // Build highlighted HTML
    let highlightedHTML = '';
    let lastIndex = 0;
    
    mergedRanges.forEach(range => {
      // Ensure ranges are within text bounds
      const safeStart = Math.max(0, Math.min(range.start, text.length));
      const safeEnd = Math.max(safeStart, Math.min(range.end, text.length));
      
      // Add text before highlight
      if (lastIndex < safeStart) {
        const beforeText = text.slice(lastIndex, safeStart);
        highlightedHTML += `<span style="background: transparent;">${this.escapeHtml(beforeText)}</span>`;
      }
      
      // Add highlighted text
      if (safeStart < safeEnd) {
        const highlightText = text.slice(safeStart, safeEnd);
        highlightedHTML += `<span style="background-color: rgba(255, 0, 0, 0.4); border-radius: 2px;">${this.escapeHtml(highlightText)}</span>`;
        console.log(`Highlighting: "${highlightText}" at ${safeStart}-${safeEnd}`);
      }
      
      lastIndex = safeEnd;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      highlightedHTML += `<span style="background: transparent;">${this.escapeHtml(remainingText)}</span>`;
    }

    overlay.innerHTML = highlightedHTML;
    document.body.appendChild(overlay);
    
    const overlayId = `overlay_${Date.now()}`;
    this.activeOverlays.set(overlayId, overlay);
    inputDiv.dataset.overlayId = overlayId;

    // Update overlay position on scroll/resize
    const updatePosition = () => {
      if (!overlay.parentNode) return;
      const newRect = inputDiv.getBoundingClientRect();
      overlay.style.top = `${newRect.top + window.scrollY}px`;
      overlay.style.left = `${newRect.left + window.scrollX}px`;
      overlay.style.width = `${newRect.width}px`;
      overlay.style.height = `${newRect.height}px`;
    };

    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);
    
    // Auto-cleanup with position listeners
    setTimeout(() => {
      if (overlay.parentNode) {
        window.removeEventListener('scroll', updatePosition);
        window.removeEventListener('resize', updatePosition);
        this.removeOverlaysForInput(inputDiv);
      }
    }, 5000);
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
    
    // Get text content - handle different input types
    const text = (inputDiv.textContent || inputDiv.innerText || inputDiv.value || '').trim();
    
    if (!text) {
      this.removeOverlaysForInput(inputDiv);
      inputDiv.style.border = "";
      inputDiv.title = "";
      return;
    }
    
    // Check cache to avoid reprocessing
    const lastText = this.lastProcessedText.get(inputDiv);
    if (lastText === text) {
      console.log("Text unchanged, skipping processing");
      return;
    }
    
    const processingKey = `${inputDiv.dataset.detectorId || 'default'}_${text.slice(0, 50)}`;
    if (this.processingQueue.has(processingKey)) {
      console.log("Already processing this text, skipping");
      return;
    }
    
    this.processingQueue.set(processingKey, true);
    
    try {
      console.log("🔍 Analyzing text:", text.substring(0, 100) + (text.length > 100 ? '...' : ''));
      
      const chunks = this.chunkText(text, 800);
      const allSensitiveRanges = [];
      
      for (const chunk of chunks) {
        const chunkRanges = await this.analyzeBulkText(chunk.text);
        
        chunkRanges.forEach(range => {
          allSensitiveRanges.push({
            start: range.start + chunk.offset,
            end: range.end + chunk.offset,
            type: range.type
          });
        });
        
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (allSensitiveRanges.length > 0) {
        console.log(`🚨 Found ${allSensitiveRanges.length} sensitive items:`, allSensitiveRanges);
        inputDiv.style.border = "2px solid red";
        inputDiv.title = `⚠️ ${allSensitiveRanges.length} sensitive items detected`;
        this.createHighlightOverlay(inputDiv, allSensitiveRanges);
      } else {
        console.log("✅ No sensitive content found");
        inputDiv.style.border = "";
        inputDiv.title = "";
        this.removeOverlaysForInput(inputDiv);
      }
      
      // Cache the result
      this.lastProcessedText.set(inputDiv, text);
      
    } catch (error) {
      console.error("❌ Processing error:", error);
    } finally {
      this.processingQueue.delete(processingKey);
    }
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
    const debounceDelay = 1500; // Shorter delay for better responsiveness
    
    const processHandler = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.processInput(inputDiv);
      }, debounceDelay);
    };

    // Enhanced event listeners to catch all changes
    const events = ['input', 'paste', 'keyup', 'keydown', 'change'];
    events.forEach(eventType => {
      inputDiv.addEventListener(eventType, processHandler);
    });
    
    // Special handling for paste events
    inputDiv.addEventListener("paste", () => {
      // Clear cache on paste to force reprocessing
      this.lastProcessedText.delete(inputDiv);
      setTimeout(processHandler, 100); // Delay to let paste complete
    });
    
    // Handle backspace/delete specially
    inputDiv.addEventListener("keydown", (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Clear cache to force reprocessing on deletion
        this.lastProcessedText.delete(inputDiv);
        processHandler();
      }
    });
    
    // Immediate blur processing
    inputDiv.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      this.processInput(inputDiv);
    });
    
    // Clear overlays when input is emptied
    inputDiv.addEventListener("input", () => {
      const text = (inputDiv.textContent || inputDiv.innerText || inputDiv.value || '').trim();
      if (!text) {
        this.lastProcessedText.delete(inputDiv);
        this.removeOverlaysForInput(inputDiv);
        inputDiv.style.border = "";
        inputDiv.title = "";
      }
    });

    // Process existing text immediately if engine is ready
    if (this.isInitialized) {
      console.log("Engine ready, processing existing text immediately");
      setTimeout(() => this.processInput(inputDiv), 100);
    }

    // Cleanup observer
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
  }

  startMonitoring() {
    console.log("🔍 Starting to monitor for input elements");
    
    const observer = new MutationObserver(() => {
      const inputDiv = document.querySelector("#ask-input");
      if (inputDiv && !this.attachedInputs.has(inputDiv)) {
        console.log("✅ Found #ask-input element");
        this.attachToInput(inputDiv);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    // Check immediately for existing input
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
  console.log("🚀 Loading bug-fixed detector...");
  
  const detector = new SensitiveTextDetector();
  await detector.initialize();
  detector.startMonitoring();
  
  console.log("✅ Bug-fixed detector ready and monitoring");
})();