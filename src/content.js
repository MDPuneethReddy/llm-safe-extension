console.log("✅ Content script loaded!");

function waitForWebLLM() {
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
      }
    };
    check();
  });
}

// Create overlay that highlights only sensitive sentences
function createSensitiveTextOverlay(inputDiv, sensitiveSentences) {
  // Remove any existing overlay
  const existingOverlay = document.querySelector('.sensitive-text-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  if (sensitiveSentences.length === 0) {
    return;
  }

  console.log("Sensitive sentences to highlight:", sensitiveSentences);
  
  const text = inputDiv.textContent;
  console.log("Full text:", JSON.stringify(text));
  
  const rect = inputDiv.getBoundingClientRect();
  
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

  // Update overlay position on scroll/resize
  const updatePosition = () => {
    const newRect = inputDiv.getBoundingClientRect();
    overlay.style.top = `${newRect.top + window.scrollY}px`;
    overlay.style.left = `${newRect.left + window.scrollX}px`;
    overlay.style.width = `${newRect.width}px`;
    overlay.style.height = `${newRect.height}px`;
  };

  window.addEventListener('scroll', updatePosition);
  window.addEventListener('resize', updatePosition);
  
  return overlay;
}

// Alternative approach: Use CSS ::selection and data attributes
function highlightSensitiveTextCSS(inputDiv, sensitiveSentences) {
  // Clear previous highlighting
  inputDiv.removeAttribute('data-sensitive-detected');
  inputDiv.classList.remove('has-sensitive-content');
  
  // Remove any existing overlay
  const existingOverlay = document.querySelector('.sensitive-text-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  if (sensitiveSentences.length === 0) {
    return;
  }

  // Create the overlay to highlight only sensitive text
  createSensitiveTextOverlay(inputDiv, sensitiveSentences);

  // Add warning tooltip
  const existing = document.querySelector('.sensitive-warning');
  if (existing) existing.remove();
  
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
  
  // Auto-hide warning after 3 seconds
  setTimeout(() => {
    if (warning.parentNode) warning.remove();
  }, 3000);
}

const systemPrompt = `
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

(async () => {
  let webllm;
  try {
    webllm = await waitForWebLLM();
  } catch (err) {
    console.error("❌ Failed to load WebLLM:", err);
    return;
  }

  let engine;
  try {
    engine = await webllm.CreateMLCEngine("Phi-3.5-mini-instruct-q4f32_1-MLC-1k");
    console.log("✅ WebLLM engine loaded.");
  } catch (err) {
    console.error("❌ Failed to create MLCEngine:", err);
    return;
  }

  // Monitor Perplexity.ai contenteditable div (#ask-input)
  const observer = new MutationObserver(() => {
    const inputDiv = document.querySelector("#ask-input");
    if (inputDiv) {
      console.log("Detected #ask-input div, attaching listener...");
      attachListener(inputDiv);
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  
  const inputDiv = document.querySelector("#ask-input");
  if (inputDiv) {
    console.log("Detected #ask-input div (immediate), attaching listener...");
    attachListener(inputDiv);
    observer.disconnect();
  }

  function attachListener(inputDiv) {
    let typingTimer;
    const doneTypingInterval = 500; // Increased to reduce API calls

    const processInput = () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(async () => {
        const text = inputDiv.textContent.trim();
        console.log("User stopped typing, input:", text);

        if (!text) {
          // Clear all highlighting when empty
          inputDiv.style.border = "";
          inputDiv.title = "";
          highlightSensitiveTextCSS(inputDiv, []);
          return;
        }

        try {
          const response = await engine.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
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
            
            // Use CSS-based highlighting instead of innerHTML manipulation
            highlightSensitiveTextCSS(inputDiv, sensitiveSentences);
            
          } else {
            console.log("No sensitive/confession sentences detected.");
            inputDiv.style.border = "";
            inputDiv.title = "";
            highlightSensitiveTextCSS(inputDiv, []);
          }
        } catch (err) {
          console.error("❌ Error during chat processing:", err);
        }
      }, doneTypingInterval);
    };

    // Attach event listeners
    inputDiv.addEventListener("input", processInput);
    inputDiv.addEventListener("blur", processInput);
    inputDiv.addEventListener("paste", () => {
      setTimeout(processInput, 100); // Wait for paste to complete
    });
    inputDiv.addEventListener("keyup", processInput);

    // Process existing text immediately after attaching
    processInput();
    
    // Clean up overlays when input loses focus or is cleared
    inputDiv.addEventListener("focus", () => {
      // Don't remove overlay on focus, keep it visible while typing
    });
    
    // Clean up when user clears the input
    inputDiv.addEventListener("input", () => {
      if (!inputDiv.textContent.trim()) {
        const overlay = document.querySelector('.sensitive-text-overlay');
        const warning = document.querySelector('.sensitive-warning');
        if (overlay) overlay.remove();
        if (warning) warning.remove();
      }
    });
  }
})();