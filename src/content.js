import { CreateMLCEngine } from "@mlc-ai/web-llm";
import {classificationPrompt} from "./config.js";
import { splitIntoSentences, chunkSentence } from "./sentencematch.js";
import { getSavedPosition, savePosition,getStatusConfig,getTooltipText } from "./statusicon.js";
import { spinnerstyles,statusTooltipstyles,spinnerAnimationStyles,escapeHtml } from "./styles.js";
import {hashCode} from "./utils.js";

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
    this.isDragging = false;
    this.dragStartTime = 0;
    
    // Use BroadcastChannel for cross-tab communication
    this.channel = new BroadcastChannel('webllm_shared_engine');
    this.channel.addEventListener('message', (event) => {
      this.handleChannelMessage(event.data);
    });
    
    // Simple binary classification prompt
    this.classificationPrompt = classificationPrompt
  }

  // Create and manage the draggable status icon
  createStatusIcon() {
    if (this.statusIcon) return;
    
    const savedPosition = getSavedPosition();
    
    // Create icon container
    this.statusIcon = document.createElement('div');
    this.statusIcon.id = 'sensitive-text-detector-icon';
    this.statusIcon.style.cssText =  `
      position: fixed;
      bottom: ${savedPosition.bottom}px;
      right: ${savedPosition.right}px;
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
      cursor: move;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
      user-select: none;
      touch-action: none;
    `

    // Create the "s" text
    const sText = document.createElement('span');
    sText.textContent = 's';
    sText.style.cssText = `
      position: relative;
      z-index: 2;
      pointer-events: none;
    `;
    this.statusIcon.appendChild(sText);

    // Create spinner overlay (initially hidden)
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.style.cssText = spinnerstyles
    this.statusIcon.appendChild(spinner);

    // Add CSS keyframes for spinner animation
    if (!document.querySelector('#detector-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'detector-spinner-styles';
      style.textContent = spinnerAnimationStyles;
      document.head.appendChild(style);
    }

    this.makeDraggable();

    // Add to page
    document.body.appendChild(this.statusIcon);

    // Set initial status
    this.updateIconStatus('not-ready');
  }

  makeDraggable() {
    let startX, startY, startRight, startBottom;
    let hasMoved = false;

    // Mouse events
    this.statusIcon.addEventListener('mousedown', (e) => {
      this.startDrag(e, e.clientX, e.clientY);
    });

    // Touch events for mobile
    this.statusIcon.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.startDrag(e, touch.clientX, touch.clientY);
    });

    const startDrag = (e, clientX, clientY) => {
      this.isDragging = true;
      this.dragStartTime = Date.now();
      hasMoved = false;
      
      const rect = this.statusIcon.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(this.statusIcon);
      
      startX = clientX;
      startY = clientY;
      startRight = parseInt(computedStyle.right);
      startBottom = parseInt(computedStyle.bottom);

      this.statusIcon.classList.add('dragging');
      
      // Show drag instructions
      this.showDragInstructions();

      // Prevent default to avoid text selection
      e.preventDefault();
    };

    const handleMove = (e, clientX, clientY) => {
      if (!this.isDragging) return;
      
      const deltaX = startX - clientX;
      const deltaY = clientY - startY;
      
      // Check if user has moved enough to be considered dragging (prevents accidental drags)
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        hasMoved = true;
      }

      const newRight = Math.max(10, Math.min(window.innerWidth - 60, startRight + deltaX));
      const newBottom = Math.max(10, Math.min(window.innerHeight - 60, startBottom + deltaY));

      this.statusIcon.style.right = `${newRight}px`;
      this.statusIcon.style.bottom = `${newBottom}px`;
    };

    const endDrag = () => {
      if (!this.isDragging) return;
      
      this.isDragging = false;
      this.statusIcon.classList.remove('dragging');
      
      // Hide drag instructions
      this.hideDragInstructions();

      // Save new position
      const computedStyle = window.getComputedStyle(this.statusIcon);
      const finalRight = parseInt(computedStyle.right);
      const finalBottom = parseInt(computedStyle.bottom);
      
      savePosition(finalRight, finalBottom);

      // If the user didn't actually drag (just clicked), show status after a short delay
      const dragDuration = Date.now() - this.dragStartTime;
      if (!hasMoved && dragDuration < 200) {
        setTimeout(() => {
          this.showStatusTooltip();
        }, 50);
      }
    };

    // Mouse move and up events
    document.addEventListener('mousemove', (e) => {
      handleMove(e, e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', endDrag);

    // Touch move and end events
    document.addEventListener('touchmove', (e) => {
      if (this.isDragging) {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(e, touch.clientX, touch.clientY);
      }
    }, { passive: false });

    document.addEventListener('touchend', endDrag);

    this.startDrag = startDrag;
  }

  showDragInstructions() {
    // Remove any existing instructions
    this.hideDragInstructions();
    
    const instructions = document.createElement('div');
    instructions.className = 'drag-instructions';
    instructions.textContent = 'Drag to move';
    this.statusIcon.appendChild(instructions);
  }

  hideDragInstructions() {
    const existing = this.statusIcon.querySelector('.drag-instructions');
    if (existing) {
      existing.remove();
    }
  }

  updateIconStatus(status) {
    if (!this.statusIcon) return;

    const spinner = this.statusIcon.querySelector('.spinner');
    const sText = this.statusIcon.querySelector('span');
    const config = getStatusConfig(status);
    if (!config) return;
    if (config.backgroundColor) {
    this.statusIcon.style.backgroundColor = config.backgroundColor;
  }
    this.statusIcon.title = config.title;
  spinner.style.opacity = config.spinnerOpacity;
  sText.style.opacity = config.textOpacity;
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
  if (this.isDragging) return;

  const tooltip = document.createElement('div');
  tooltip.style.cssText = statusTooltipstyles;

  // 🔹 Get tooltip message from config module
  const statusText = getTooltipText({
    isInitialized: this.isInitialized,
    isMainTab: this.isMainTab,
    isProcessing: this.isProcessing
  });

  tooltip.textContent = statusText;

  // Position tooltip relative to the status icon
  const iconRect = this.statusIcon.getBoundingClientRect();
  const tooltipWidth = 320;
  const tooltipHeight = 120;

  let tooltipLeft = iconRect.left - tooltipWidth + iconRect.width;
  let tooltipTop = iconRect.top - tooltipHeight - 10;

  if (tooltipLeft < 10) tooltipLeft = iconRect.right + 10;
  if (tooltipTop < 10) tooltipTop = iconRect.bottom + 10;
  if (tooltipLeft + tooltipWidth > window.innerWidth - 10) {
    tooltipLeft = window.innerWidth - tooltipWidth - 10;
  }

  tooltip.style.left = `${tooltipLeft}px`;
  tooltip.style.top = `${tooltipTop}px`;

  document.body.appendChild(tooltip);

  setTimeout(() => {
    if (tooltip.parentNode) tooltip.remove();
  }, 4000);
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
              this.statusIcon.title = `🟡 Loading AI Model: ${percentage}%\n(Click for info, drag to move)`;
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
          this.statusIcon.title = `🟡 Loading AI Model: ${percentage}%\n(Click for info, drag to move)`;
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



async processSentencesWithRealTimeHighlighting(sentences, inputDiv, batchSize = 3) {
  const allResults = [];
  let currentSensitiveRanges = [];

  // Chunk long sentences first
  const expandedSentences = sentences.flatMap(s => chunkSentence(s));

  for (let i = 0; i < expandedSentences.length; i += batchSize) {
    const batch = expandedSentences.slice(i, i + batchSize);

    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(expandedSentences.length/batchSize)}: ${batch.length} sentences`);

    const batchPromises = batch.map(async (sentenceObj) => {
      try {
        const isSensitive = await this.classifySentence(sentenceObj.text);
        const result = { ...sentenceObj, isSensitive };

        if (isSensitive) {
          console.log(`🚨 Real-time highlight: "${sentenceObj.text}"`);
          currentSensitiveRanges.push({
            start: sentenceObj.start,
            end: sentenceObj.end,
            type: 'sensitive',
            text: sentenceObj.text
          });

          this.createHighlightOverlay(inputDiv, [...currentSensitiveRanges]);
          inputDiv.style.border = "2px solid red";
          inputDiv.title = `⚠️ ${currentSensitiveRanges.length} sensitive sentence(s) detected`;
        }

        return result;
      } catch (error) {
        console.error("Error processing sentence:", sentenceObj.text, error);
        return { ...sentenceObj, isSensitive: false };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);

    if (i + batchSize < expandedSentences.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return allResults;
}

  async analyzeBulkText(text, inputDiv) {
    try {
      console.log(`🔍 Analyzing text: "${text.substring(0, 50)}..." (${text.length} chars)`);
      
      // Split into sentences
      const sentences = splitIntoSentences(text);
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
  
  // Create overlay container with improved positioning
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
    border: transparent;
    box-sizing: ${computedStyle.boxSizing};
    white-space: ${computedStyle.whiteSpace};
    word-wrap: ${computedStyle.wordWrap};
    word-break: ${computedStyle.wordBreak};
    overflow: ${computedStyle.overflow};
    color: transparent;
    background: transparent;
    text-align: ${computedStyle.textAlign};
    vertical-align: ${computedStyle.verticalAlign};
    text-indent: ${computedStyle.textIndent};
    text-transform: ${computedStyle.textTransform};
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
      highlightedHTML += `<span>${escapeHtml(beforeText)}</span>`;
    }
    
    // Add highlighted sentence
    const sentenceText = text.slice(range.start, range.end);
    
    highlightedHTML += `<span style="background-color: rgba(255, 0, 0, 0.3); border-radius: 3px; padding: 2px; box-decoration-break: clone;" title="⚠️ Sensitive sentence detected">${escapeHtml(sentenceText)}</span>`;
    
    console.log(`Highlighting sentence: "${sentenceText}" at ${range.start}-${range.end}`);
    lastIndex = range.end;
  });
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    highlightedHTML += `<span>${escapeHtml(remainingText)}</span>`;
  }

  overlay.innerHTML = highlightedHTML;
  document.body.appendChild(overlay);
  
  const overlayId = `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  this.activeOverlays.set(overlayId, overlay);
  inputDiv.dataset.overlayId = overlayId;

  // Enhanced position updates with better scroll handling
  const updatePosition = () => {
    if (!overlay.parentNode || !document.body.contains(inputDiv)) {
      this.removeOverlaysForInput(inputDiv);
      return;
    }
    
    const newRect = inputDiv.getBoundingClientRect();
    
    // Check if element is visible in viewport
    const isVisible = newRect.top < window.innerHeight && 
                     newRect.bottom > 0 && 
                     newRect.left < window.innerWidth && 
                     newRect.right > 0;
    
    if (isVisible) {
      overlay.style.display = 'block';
      overlay.style.top = `${newRect.top + window.scrollY}px`;
      overlay.style.left = `${newRect.left + window.scrollX}px`;
      overlay.style.width = `${newRect.width}px`;
      overlay.style.height = `${newRect.height}px`;
    } else {
      // Hide overlay when input is not visible
      overlay.style.display = 'none';
    }
  };

  // Improved throttling with immediate first update
  let isThrottled = false;
  const throttledUpdate = () => {
    if (isThrottled) return;
    
    isThrottled = true;
    requestAnimationFrame(() => {
      updatePosition();
      isThrottled = false;
    });
  };

  // Multiple scroll listeners for better coverage
  const scrollListener = throttledUpdate;
  const resizeListener = throttledUpdate;
  
  // Listen on multiple elements that might scroll
  window.addEventListener('scroll', scrollListener, { passive: true, capture: true });
  document.addEventListener('scroll', scrollListener, { passive: true, capture: true });
  window.addEventListener('resize', resizeListener, { passive: true });
  
  // Also listen on the input's scroll containers
  let scrollContainer = inputDiv.parentElement;
  const containerListeners = [];
  
  while (scrollContainer && scrollContainer !== document.body) {
    const containerStyle = window.getComputedStyle(scrollContainer);
    if (containerStyle.overflow !== 'visible') {
      scrollContainer.addEventListener('scroll', scrollListener, { passive: true });
      containerListeners.push({ element: scrollContainer, listener: scrollListener });
    }
    scrollContainer = scrollContainer.parentElement;
  }
  
  // Initial position update
  updatePosition();
  
  overlay.cleanup = () => {
    window.removeEventListener('scroll', scrollListener, { capture: true });
    document.removeEventListener('scroll', scrollListener, { capture: true });
    window.removeEventListener('resize', resizeListener);
    
    // Clean up container listeners
    containerListeners.forEach(({ element, listener }) => {
      element.removeEventListener('scroll', listener);
    });
  };
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
  
  // Also clean up any orphaned overlays
  this.activeOverlays.forEach((overlay, id) => {
    if (!overlay.parentNode || !document.body.contains(overlay)) {
      this.activeOverlays.delete(id);
    }
  });
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
    
    const processingKey = `${inputDiv.dataset.detectorId || 'default'}_${hashCode(text)}`;
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
    const scrollHandler = () => {
    // Update overlay positions when scrolling
    if (inputDiv.dataset.overlayId) {
      const overlay = this.activeOverlays.get(inputDiv.dataset.overlayId);
      if (overlay && overlay.parentNode) {
        const rect = inputDiv.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && 
                         rect.bottom > 0 && 
                         rect.left < window.innerWidth && 
                         rect.right > 0;
        
        if (isVisible) {
          overlay.style.display = 'block';
          overlay.style.top = `${rect.top + window.scrollY}px`;
          overlay.style.left = `${rect.left + window.scrollX}px`;
        } else {
          overlay.style.display = 'none';
        }
      }
    }
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
        setTimeout(() => {
      clearTimeout(debounceTimer);
      this.processInput(inputDiv);
    }, 300);
      }
    });
    
    inputDiv.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      this.processInput(inputDiv);
    });
    inputDiv.addEventListener('scroll', scrollHandler, { passive: true });
    
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
      let shouldUpdatePosition = false;
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
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
        shouldUpdatePosition = true;
      }
      });
      if (shouldUpdatePosition) {
      setTimeout(scrollHandler, 10);
    }
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
  console.log("🚀 Loading sentence-by-sentence detector with draggable status button...");
  
  const detector = new SensitiveTextDetector();
  await detector.initialize();
  detector.startMonitoring();
  
  console.log("✅ Sentence detector ready and monitoring - drag the status button to move it around!");
})();