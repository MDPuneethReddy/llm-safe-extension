console.log("✅ Content script loaded!");

// Singleton class for managing sensitive text detection
class SensitiveTextDetector {
  static instance = null;
  
  constructor() {
    if (SensitiveTextDetector.instance) {
      return SensitiveTextDetector.instance;
    }
    
    this.webllm = null;
    this.engine = null;
    this.isInitializing = false;
    this.isInitialized = false;
    this.attachedInputs = new WeakSet();
    this.activeOverlays = new Map(); // Track overlays per input element
    this.systemPrompt = `
You are a content filter. Your job is to analyze a user's input and return ONLY a JSON array of sentences that meet the following criteria:

CRITERIA:
1. A sentence that is a clear confession of a serious illegal act that could lead to jail or criminal prosecution (e.g., theft, assault, tax evasion, murder, fraud).
2. A sentence that includes personal data or sensitive information, such as:
   - Social Security Numbers
   - Phone numbers or email addresses
   - API keys or authentication tokens
   - Production credentials or URLs

CRITICAL INSTRUCTIONS FOR EXACT MATCHING:
- Return each sentence EXACTLY as it appears in the user's input
- Preserve ALL punctuation marks exactly (periods, commas, exclamation marks, question marks, etc.)
- Preserve ALL capitalization exactly as written
- Preserve ALL spacing exactly as written
- Do NOT modify, rephrase, or rewrite any part of the sentences
- Copy the sentences character-for-character from the original text

RESPONSE FORMAT:
- Return ONLY a raw JSON array, like ["sentence one.", "sentence two."]. 
- DO NOT include any explanations, notes, markdown formatting (e.g. json), or extra text.
- If no sentence qualifies, return an empty array: []

EXAMPLES:
Input: "I am a good person. I didn't pay taxes! My SSN is 123-45-6789..."
Output: ["I didn't pay taxes", "My SSN is 123-45-6789"]

Input: "hello world. My phone is 555-1234. I love dogs?"
Output: ["My phone is 555-1234"]

Input: "I love dogs. The weather is nice."
Output: []

Remember: Copy sentences EXACTLY as they appear in the input text with identical punctuation and spacing.
`;
    
    SensitiveTextDetector.instance = this;
    this.init();
  }
  
  static getInstance() {
    if (!SensitiveTextDetector.instance) {
      SensitiveTextDetector.instance = new SensitiveTextDetector();
    }
    return SensitiveTextDetector.instance;
  }
  
  async init() {
    if (this.isInitializing || this.isInitialized) {
      return;
    }
    
    this.isInitializing = true;
    
    try {
      this.webllm = await this.waitForWebLLM();
      this.engine = await this.webllm.CreateMLCEngine("Phi-3.5-mini-instruct-q4f32_1-MLC-1k");
      console.log("✅ WebLLM engine loaded in singleton.");
      this.isInitialized = true;
    } catch (err) {
      console.error("❌ Failed to initialize WebLLM in singleton:", err);
    } finally {
      this.isInitializing = false;
    }
  }
  
  waitForWebLLM() {
    return new Promise((resolve) => {
      const check = () => {
        try {
          if (
            window.webllm &&
            typeof window.webllm.CreateMLCEngine === "function"
          ) {
            resolve(window.webllm);
          } else {
            setTimeout(check, 500);
          }
        } catch (err) {
          console.error("Error in waitForWebLLM check:", err);
          setTimeout(check, 500);
        }
      };
      check();
    });
  }
  
  // Clean up overlays for a specific input
  removeOverlaysForInput(inputDiv) {
    const overlayKey = `overlay_${inputDiv.dataset.detectorId || 'default'}`;
    const warningKey = `warning_${inputDiv.dataset.detectorId || 'default'}`;
    
    const overlay = this.activeOverlays.get(overlayKey);
    const warning = this.activeOverlays.get(warningKey);
    
    if (overlay && overlay.parentNode) {
      overlay.remove();
      this.activeOverlays.delete(overlayKey);
    }
    
    if (warning && warning.parentNode) {
      warning.remove();
      this.activeOverlays.delete(warningKey);
    }
  }
  
  // Create overlay that highlights only sensitive sentences
  createSensitiveTextOverlay(inputDiv, sensitiveSentences) {
    // Remove any existing overlay for this input
    this.removeOverlaysForInput(inputDiv);

    if (sensitiveSentences.length === 0) {
      return;
    }

    console.log("Sensitive sentences to highlight:", sensitiveSentences);
    
    const text = inputDiv.textContent;
    console.log("Full text:", JSON.stringify(text));
    
    const rect = inputDiv.getBoundingClientRect();
    
    // Assign unique ID if not exists
    if (!inputDiv.dataset.detectorId) {
      inputDiv.dataset.detectorId = `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Create overlay div that matches the input exactly
    const overlay = document.createElement('div');
    overlay.className = 'sensitive-text-overlay';
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
      border: transparent;
      box-sizing: border-box;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow: hidden;
      color: transparent;
    `;

    // Find exact matches for each sensitive sentence in the text
    const highlightRanges = [];
    
    sensitiveSentences.forEach(sensitiveSentence => {
      console.log("Looking for:", JSON.stringify(sensitiveSentence));
      
      // Try exact match first
      let startIndex = text.indexOf(sensitiveSentence);
      if (startIndex !== -1) {
        highlightRanges.push({
          start: startIndex,
          end: startIndex + sensitiveSentence.length
        });
        console.log("Found exact match at:", startIndex, "to", startIndex + sensitiveSentence.length);
        return;
      }
      
      // Try with trimmed whitespace
      const trimmedSensitive = sensitiveSentence.trim();
      startIndex = text.indexOf(trimmedSensitive);
      if (startIndex !== -1) {
        highlightRanges.push({
          start: startIndex,
          end: startIndex + trimmedSensitive.length
        });
        console.log("Found trimmed match at:", startIndex, "to", startIndex + trimmedSensitive.length);
        return;
      }
      
      // Try case-insensitive match
      const lowerText = text.toLowerCase();
      const lowerSensitive = sensitiveSentence.toLowerCase();
      startIndex = lowerText.indexOf(lowerSensitive);
      if (startIndex !== -1) {
        highlightRanges.push({
          start: startIndex,
          end: startIndex + sensitiveSentence.length
        });
        console.log("Found case-insensitive match at:", startIndex, "to", startIndex + sensitiveSentence.length);
        return;
      }
      
      // Try case-insensitive with trimmed
      const lowerTrimmedSensitive = trimmedSensitive.toLowerCase();
      startIndex = lowerText.indexOf(lowerTrimmedSensitive);
      if (startIndex !== -1) {
        highlightRanges.push({
          start: startIndex,
          end: startIndex + trimmedSensitive.length
        });
        console.log("Found case-insensitive trimmed match at:", startIndex, "to", startIndex + trimmedSensitive.length);
        return;
      }
      
      console.warn("No match found for:", JSON.stringify(sensitiveSentence));
    });
    
    // Sort ranges by start position
    highlightRanges.sort((a, b) => a.start - b.start);
    
    // Merge overlapping ranges
    const mergedRanges = [];
    highlightRanges.forEach(range => {
      if (mergedRanges.length === 0 || mergedRanges[mergedRanges.length - 1].end < range.start) {
        mergedRanges.push(range);
      } else {
        // Merge with previous range
        mergedRanges[mergedRanges.length - 1].end = Math.max(mergedRanges[mergedRanges.length - 1].end, range.end);
      }
    });
    
    console.log("Final highlight ranges:", mergedRanges);
    
    // Build the highlighted HTML
    let highlightedHTML = '';
    let textIndex = 0;
    
    mergedRanges.forEach(range => {
      // Add non-highlighted text before this range
      if (textIndex < range.start) {
        highlightedHTML += `<span style="color: transparent;">${text.slice(textIndex, range.start)}</span>`;
      }
      
      // Add highlighted text
      highlightedHTML += `<span style="background-color: rgba(255, 0, 0, 0.4); color: transparent;">${text.slice(range.start, range.end)}</span>`;
      
      textIndex = range.end;
    });
    
    // Add remaining non-highlighted text
    if (textIndex < text.length) {
      highlightedHTML += `<span style="color: transparent;">${text.slice(textIndex)}</span>`;
    }

    overlay.innerHTML = highlightedHTML;
    document.body.appendChild(overlay);
    
    // Store overlay reference
    const overlayKey = `overlay_${inputDiv.dataset.detectorId}`;
    this.activeOverlays.set(overlayKey, overlay);

    // Update overlay position on scroll/resize
    const updatePosition = () => {
      if (!overlay.parentNode) return; // Overlay removed
      const newRect = inputDiv.getBoundingClientRect();
      overlay.style.top = `${newRect.top + window.scrollY}px`;
      overlay.style.left = `${newRect.left + window.scrollX}px`;
      overlay.style.width = `${newRect.width}px`;
      overlay.style.height = `${newRect.height}px`;
    };

    // Use bound function to avoid duplicate listeners
    const boundUpdatePosition = updatePosition.bind(this);
    window.addEventListener('scroll', boundUpdatePosition);
    window.addEventListener('resize', boundUpdatePosition);
    
    // Clean up listeners when overlay is removed
    const originalRemove = overlay.remove;
    overlay.remove = function() {
      window.removeEventListener('scroll', boundUpdatePosition);
      window.removeEventListener('resize', boundUpdatePosition);
      originalRemove.call(this);
    };
    
    return overlay;
  }

  // Highlight sensitive text with CSS and warnings
  highlightSensitiveTextCSS(inputDiv, sensitiveSentences) {
    // Clear previous highlighting
    inputDiv.removeAttribute('data-sensitive-detected');
    inputDiv.classList.remove('has-sensitive-content');
    
    if (sensitiveSentences.length === 0) {
      this.removeOverlaysForInput(inputDiv);
      return;
    }

    // Create the overlay to highlight only sensitive text
    this.createSensitiveTextOverlay(inputDiv, sensitiveSentences);

    // Add warning tooltip
    const warningKey = `warning_${inputDiv.dataset.detectorId}`;
    const existingWarning = this.activeOverlays.get(warningKey);
    if (existingWarning && existingWarning.parentNode) {
      existingWarning.remove();
    }
    
    const warning = document.createElement('div');
    warning.className = 'sensitive-warning';
    warning.textContent = `⚠️ ${sensitiveSentences.length} sensitive item(s) detected`;
    
    const rect = inputDiv.getBoundingClientRect();
    warning.style.cssText = `
      position: absolute;
      top: ${rect.top + window.scrollY - 30}px;
      left: ${rect.left + window.scrollX}px;
      background: #ff4444;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1001;
      pointer-events: none;
    `;
    
    document.body.appendChild(warning);
    this.activeOverlays.set(warningKey, warning);
    
    // Auto-hide warning after 3 seconds
    setTimeout(() => {
      if (warning.parentNode) {
        warning.remove();
        this.activeOverlays.delete(warningKey);
      }
    }, 3000);
  }
  
  async processInput(inputDiv) {
    if (!this.isInitialized) {
      console.warn("⚠️ Engine not initialized yet");
      return;
    }
    
    const text = inputDiv.textContent.trim();
    console.log("Processing input:", text);

    if (!text) {
      // Clear all highlighting when empty
      inputDiv.style.border = "";
      inputDiv.title = "";
      this.highlightSensitiveTextCSS(inputDiv, []);
      return;
    }

    try {
      const response = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: text },
        ],
      });

      console.log("Full response:", response);

      let sensitiveSentences = [];
      const llmContent = response.choices[0].message.content.trim();
      console.log("LLM content:", llmContent);

      // Try to parse JSON from the response
      const match = llmContent.match(/```json\s*(\[[^\]]*\])\s*```/i) || llmContent.match(/(\[[^\]]*\])/);
      if (match && match[1]) {
        try {
          sensitiveSentences = JSON.parse(match[1]);
          if (!Array.isArray(sensitiveSentences)) throw new Error("Not an array");
        } catch (e) {
          console.warn("⚠️ Could not parse JSON array from LLM content.", e);
          sensitiveSentences = [];
        }
      } else {
        try {
          sensitiveSentences = JSON.parse(llmContent);
          if (!Array.isArray(sensitiveSentences)) throw new Error("Not an array");
        } catch (e) {
          console.warn("⚠️ No JSON array found in LLM content.");
          sensitiveSentences = [];
        }
      }

      if (sensitiveSentences.length > 0) {
        console.log("Detected sensitive/confession sentences:", sensitiveSentences);
        inputDiv.style.border = "2px solid red";
        inputDiv.title = "⚠️ Sensitive or criminal confession detected";
        
        this.highlightSensitiveTextCSS(inputDiv, sensitiveSentences);
        
      } else {
        console.log("No sensitive/confession sentences detected.");
        inputDiv.style.border = "";
        inputDiv.title = "";
        this.highlightSensitiveTextCSS(inputDiv, []);
      }
    } catch (err) {
      console.error("❌ Error during chat processing:", err);
    }
  }
  
  attachToInput(inputDiv) {
    // Prevent multiple attachments to the same element
    if (this.attachedInputs.has(inputDiv)) {
      console.log("Input already monitored, skipping...");
      return;
    }
    
    this.attachedInputs.add(inputDiv);
    console.log("Attaching listener to input...");
    
    let typingTimer;
    const doneTypingInterval = 500;

    const processInputHandler = () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        this.processInput(inputDiv);
      }, doneTypingInterval);
    };

    // Attach event listeners
    inputDiv.addEventListener("input", processInputHandler);
    inputDiv.addEventListener("blur", processInputHandler);
    inputDiv.addEventListener("paste", () => {
      setTimeout(processInputHandler, 100); // Wait for paste to complete
    });
    inputDiv.addEventListener("keyup", processInputHandler);

    // Process existing text immediately after attaching
    if (this.isInitialized) {
      processInputHandler();
    }
    
    // Clean up when user clears the input
    inputDiv.addEventListener("input", () => {
      if (!inputDiv.textContent.trim()) {
        this.removeOverlaysForInput(inputDiv);
      }
    });
    
    // Clean up when input is removed from DOM
    const cleanupObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === inputDiv || (node.nodeType === 1 && node.contains(inputDiv))) {
            this.removeOverlaysForInput(inputDiv);
            this.attachedInputs.delete(inputDiv);
            cleanupObserver.disconnect();
          }
        });
      });
    });
    
    cleanupObserver.observe(document.body, { childList: true, subtree: true });
  }
  
  startMonitoring() {
    // Monitor for Perplexity.ai contenteditable div (#ask-input)
    const observer = new MutationObserver(() => {
      const inputDiv = document.querySelector("#ask-input");
      if (inputDiv && !this.attachedInputs.has(inputDiv)) {
        console.log("Detected #ask-input div, attaching listener...");
        this.attachToInput(inputDiv);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    // Check for existing input immediately
    const inputDiv = document.querySelector("#ask-input");
    if (inputDiv && !this.attachedInputs.has(inputDiv)) {
      console.log("Detected #ask-input div (immediate), attaching listener...");
      this.attachToInput(inputDiv);
    }
  }
}

// Initialize the singleton
(async () => {
  const detector = SensitiveTextDetector.getInstance();
  
  // Wait for initialization to complete
  const waitForInit = () => {
    return new Promise((resolve) => {
      const checkInit = () => {
        if (detector.isInitialized) {
          resolve();
        } else if (!detector.isInitializing) {
          // If not initializing and not initialized, something went wrong
          console.error("❌ Failed to initialize detector");
          resolve();
        } else {
          setTimeout(checkInit, 100);
        }
      };
      checkInit();
    });
  };
  
  await waitForInit();
  
  if (detector.isInitialized) {
    detector.startMonitoring();
  } else {
    console.error("❌ Could not start monitoring - detector not initialized");
  }
})();