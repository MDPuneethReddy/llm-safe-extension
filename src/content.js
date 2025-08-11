console.log("✅ Content script loaded!");

// Smart sentence splitting that preserves exact formatting
function splitIntoSentences(text) {
  const sentences = [];
  let currentStart = 0;
  
  // More comprehensive sentence ending patterns
  const sentenceEndPattern = /[.!?]+\s+/g;
  let match;
  
  while ((match = sentenceEndPattern.exec(text)) !== null) {
    const endIndex = match.index + match[0].length;
    const sentence = text.slice(currentStart, endIndex).trim();
    
    if (sentence.length > 0) {
      sentences.push({
        text: sentence,
        start: currentStart,
        end: endIndex
      });
    }
    
    currentStart = endIndex;
  }
  
  // Handle the last sentence (might not end with punctuation)
  if (currentStart < text.length) {
    const lastSentence = text.slice(currentStart).trim();
    if (lastSentence.length > 0) {
      sentences.push({
        text: lastSentence,
        start: currentStart,
        end: text.length
      });
    }
  }
  
  // Fallback: if no sentences found, treat entire text as one sentence
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push({
      text: text.trim(),
      start: 0,
      end: text.length
    });
  }
  
  console.log("Split into sentences:", sentences);
  return sentences;
}

// Enhanced sentence splitting with better edge case handling
function advancedSentenceSplit(text) {
  const sentences = [];
  
  // Handle multiple splitting strategies
  const strategies = [
    // Strategy 1: Standard sentence endings
    () => splitIntoSentences(text),
    
    // Strategy 2: Line breaks as sentence boundaries
    () => {
      const lines = text.split(/\n+/);
      return lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return null;
        
        const start = text.indexOf(line);
        return {
          text: trimmed,
          start: start,
          end: start + line.length
        };
      }).filter(Boolean);
    },
    
    // Strategy 3: Comma-separated clauses for long sentences
    () => {
      if (text.length > 200 && !text.includes('.') && !text.includes('!') && !text.includes('?')) {
        const clauses = text.split(/,\s+/);
        let currentStart = 0;
        return clauses.map(clause => {
          const trimmed = clause.trim();
          if (trimmed.length === 0) return null;
          
          const start = currentStart;
          const end = start + clause.length;
          currentStart = end + 2; // account for ", "
          
          return {
            text: trimmed,
            start: start,
            end: Math.min(end, text.length)
          };
        }).filter(Boolean);
      }
      return [];
    }
  ];
  
  // Try strategies in order, return the first that produces results
  for (const strategy of strategies) {
    const result = strategy();
    if (result && result.length > 0) {
      return result;
    }
  }
  
  // Ultimate fallback
  return [{
    text: text.trim(),
    start: 0,
    end: text.length
  }];
}

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
    this.activeOverlays = new Map();
    
    // Simple binary classification prompt
    this.classificationPrompt = `
You are a content classifier. Analyze the given sentence and determine if it contains sensitive information.

SENSITIVE INFORMATION INCLUDES:
1. Personal data: Social Security Numbers, phone numbers, email addresses, home addresses
2. Financial data: Credit card numbers, bank account numbers, routing numbers
3. Authentication: Passwords, API keys, access tokens, authentication credentials
4. Production systems: Database URLs, production server addresses, internal system URLs
5. Criminal confessions: Admissions of illegal activities (theft, assault, fraud, tax evasion, etc.)

RESPOND WITH ONLY:
- "true" if the sentence contains sensitive information
- "false" if the sentence does not contain sensitive information

Do not include any explanations, reasoning, or additional text.

Examples:
Input: "My SSN is 123-45-6789."
Output: true

Input: "I stole money from the register."
Output: true

Input: "I love programming."
Output: false

Input: "The weather is nice today."
Output: false
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
  
  // Classify a single sentence
  async classifySentence(sentence) {
    try {
      const response = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: this.classificationPrompt },
          { role: "user", content: sentence },
        ],
        temperature: 0.0, // Deterministic responses
        max_tokens: 10,   // Only need "true" or "false"
      });
      
      const result = response.choices[0].message.content.trim().toLowerCase();
      console.log(`Sentence: "${sentence}" -> Classification: ${result}`);
      
      // Parse the response - look for "true" anywhere in the response
      return result.includes('true');
      
    } catch (err) {
      console.error("❌ Error classifying sentence:", err);
      return false; // Default to safe (not sensitive)
    }
  }
  
  // Main processing function with sentence-by-sentence analysis
  async processSentences(text) {
    console.log("🔍 Starting sentence-by-sentence analysis");
    
    // Step 1: Split into sentences
    const sentences = advancedSentenceSplit(text);
    console.log(`Split text into ${sentences.length} sentences`);
    
    // Step 2: Classify each sentence
    const sensitiveSentences = [];
    const sensitiveRanges = [];
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      console.log(`Analyzing sentence ${i + 1}/${sentences.length}: "${sentence.text}"`);
      
      const isSensitive = await this.classifySentence(sentence.text);
      
      if (isSensitive) {
        console.log(`✅ Sentence ${i + 1} is SENSITIVE: "${sentence.text}"`);
        sensitiveSentences.push(sentence.text);
        sensitiveRanges.push({
          start: sentence.start,
          end: sentence.end
        });
      } else {
        console.log(`✅ Sentence ${i + 1} is safe`);
      }
      
      // Small delay to prevent overwhelming the model
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log("🎯 Analysis complete. Sensitive sentences:", sensitiveSentences);
    
    return {
      sensitiveSentences,
      sensitiveRanges
    };
  }
  
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
  
  // Create overlay using the exact ranges from sentence analysis
  createSensitiveTextOverlay(inputDiv, sensitiveRanges) {
    this.removeOverlaysForInput(inputDiv);

    if (sensitiveRanges.length === 0) {
      return;
    }

    console.log("Creating overlay for ranges:", sensitiveRanges);
    
    const text = inputDiv.textContent;
    const rect = inputDiv.getBoundingClientRect();
    
    if (!inputDiv.dataset.detectorId) {
      inputDiv.dataset.detectorId = `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
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

    // Sort ranges by start position
    const sortedRanges = [...sensitiveRanges].sort((a, b) => a.start - b.start);
    
    // Merge overlapping ranges
    const mergedRanges = [];
    sortedRanges.forEach(range => {
      if (mergedRanges.length === 0 || mergedRanges[mergedRanges.length - 1].end < range.start) {
        mergedRanges.push(range);
      } else {
        mergedRanges[mergedRanges.length - 1].end = Math.max(mergedRanges[mergedRanges.length - 1].end, range.end);
      }
    });
    
    console.log("Final highlight ranges:", mergedRanges);
    
    // Build highlighted HTML
    let highlightedHTML = '';
    let textIndex = 0;
    
    mergedRanges.forEach(range => {
      // Add non-highlighted text before this range
      if (textIndex < range.start) {
        const beforeText = text.slice(textIndex, range.start);
        highlightedHTML += `<span style="color: transparent;">${this.escapeHtml(beforeText)}</span>`;
      }
      
      // Add highlighted text
      const highlightText = text.slice(range.start, range.end);
      highlightedHTML += `<span style="background-color: rgba(255, 0, 0, 0.4); color: transparent;">${this.escapeHtml(highlightText)}</span>`;
      
      textIndex = range.end;
    });
    
    // Add remaining non-highlighted text
    if (textIndex < text.length) {
      const remainingText = text.slice(textIndex);
      highlightedHTML += `<span style="color: transparent;">${this.escapeHtml(remainingText)}</span>`;
    }

    overlay.innerHTML = highlightedHTML;
    document.body.appendChild(overlay);
    
    const overlayKey = `overlay_${inputDiv.dataset.detectorId}`;
    this.activeOverlays.set(overlayKey, overlay);

    // Position updating
    const updatePosition = () => {
      if (!overlay.parentNode) return;
      const newRect = inputDiv.getBoundingClientRect();
      overlay.style.top = `${newRect.top + window.scrollY}px`;
      overlay.style.left = `${newRect.left + window.scrollX}px`;
      overlay.style.width = `${newRect.width}px`;
      overlay.style.height = `${newRect.height}px`;
    };

    const boundUpdatePosition = updatePosition.bind(this);
    window.addEventListener('scroll', boundUpdatePosition);
    window.addEventListener('resize', boundUpdatePosition);
    
    const originalRemove = overlay.remove;
    overlay.remove = function() {
      window.removeEventListener('scroll', boundUpdatePosition);
      window.removeEventListener('resize', boundUpdatePosition);
      originalRemove.call(this);
    };
    
    return overlay;
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  highlightSensitiveTextCSS(inputDiv, sensitiveRanges) {
    inputDiv.removeAttribute('data-sensitive-detected');
    inputDiv.classList.remove('has-sensitive-content');
    
    if (sensitiveRanges.length === 0) {
      this.removeOverlaysForInput(inputDiv);
      return;
    }

    this.createSensitiveTextOverlay(inputDiv, sensitiveRanges);

    // Add warning
    const warningKey = `warning_${inputDiv.dataset.detectorId}`;
    const existingWarning = this.activeOverlays.get(warningKey);
    if (existingWarning && existingWarning.parentNode) {
      existingWarning.remove();
    }
    
    const warning = document.createElement('div');
    warning.className = 'sensitive-warning';
    warning.textContent = `⚠️ ${sensitiveRanges.length} sensitive sentence(s) detected`;
    
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
    
    setTimeout(() => {
      if (warning.parentNode) {
        warning.remove();
        this.activeOverlays.delete(warningKey);
      }
    }, 4000);
  }
  
  // Updated main processing function
  async processInput(inputDiv) {
    if (!this.isInitialized) {
      console.warn("⚠️ Engine not initialized yet");
      return;
    }
    
    const text = inputDiv.textContent.trim();
    console.log("Processing input:", text);

    if (!text) {
      inputDiv.style.border = "";
      inputDiv.title = "";
      this.highlightSensitiveTextCSS(inputDiv, []);
      return;
    }

    try {
      console.log("🚀 Starting sentence-by-sentence analysis...");
      
      // Process sentences one by one
      const result = await this.processSentences(text);
      
      if (result.sensitiveSentences.length > 0) {
        console.log("🚨 Detected sensitive sentences:", result.sensitiveSentences);
        inputDiv.style.border = "2px solid red";
        inputDiv.title = `⚠️ ${result.sensitiveSentences.length} sensitive sentence(s) detected`;
        
        // Use the exact ranges for highlighting
        this.highlightSensitiveTextCSS(inputDiv, result.sensitiveRanges);
        
      } else {
        console.log("✅ No sensitive content detected.");
        inputDiv.style.border = "";
        inputDiv.title = "";
        this.highlightSensitiveTextCSS(inputDiv, []);
      }
    } catch (err) {
      console.error("❌ Error during processing:", err);
    }
  }
  
  attachToInput(inputDiv) {
    if (this.attachedInputs.has(inputDiv)) {
      console.log("Input already monitored, skipping...");
      return;
    }
    
    this.attachedInputs.add(inputDiv);
    console.log("Attaching listener to input...");
    
    let typingTimer;
    const doneTypingInterval = 1000; // Longer delay since we're doing multiple LLM calls

    const processInputHandler = () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        this.processInput(inputDiv);
      }, doneTypingInterval);
    };

    inputDiv.addEventListener("input", processInputHandler);
    inputDiv.addEventListener("blur", processInputHandler);
    inputDiv.addEventListener("paste", () => {
      setTimeout(processInputHandler, 200);
    });

    if (this.isInitialized) {
      processInputHandler();
    }
    
    inputDiv.addEventListener("input", () => {
      if (!inputDiv.textContent.trim()) {
        this.removeOverlaysForInput(inputDiv);
      }
    });
    
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
    const observer = new MutationObserver(() => {
      const inputDiv = document.querySelector("#ask-input");
      if (inputDiv && !this.attachedInputs.has(inputDiv)) {
        console.log("Detected #ask-input div, attaching listener...");
        this.attachToInput(inputDiv);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
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
  
  const waitForInit = () => {
    return new Promise((resolve) => {
      const checkInit = () => {
        if (detector.isInitialized) {
          resolve();
        } else if (!detector.isInitializing) {
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