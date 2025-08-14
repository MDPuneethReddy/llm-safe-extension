import { CreateMLCEngine } from "@mlc-ai/web-llm";

/* ---------------- Utility: sentence splitting ---------------- */
function splitIntoSentences(text) {
  const sentences = [];
  let currentStart = 0;
  const sentenceEndPattern = /[.!?]+\s+/g;
  let match;
  while ((match = sentenceEndPattern.exec(text)) !== null) {
    const endIndex = match.index + match[0].length;
    const sentence = text.slice(currentStart, endIndex).trim();
    if (sentence.length > 0) {
      sentences.push({ text: sentence, start: currentStart, end: endIndex });
    }
    currentStart = endIndex;
  }
  if (currentStart < text.length) {
    const lastSentence = text.slice(currentStart).trim();
    if (lastSentence.length > 0) {
      sentences.push({ text: lastSentence, start: currentStart, end: text.length });
    }
  }
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push({ text: text.trim(), start: 0, end: text.length });
  }
  return sentences;
}

function advancedSentenceSplit(text) {
  const strategies = [
    () => splitIntoSentences(text),
    () => {
      const lines = text.split(/\n+/);
      return lines
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          const start = text.indexOf(line);
          return { text: trimmed, start, end: start + line.length };
        })
        .filter(Boolean);
    },
    () => {
      if (text.length > 200 && !/[.!?]/.test(text)) {
        const clauses = text.split(/,\s+/);
        let currentStart = 0;
        return clauses
          .map((clause) => {
            const trimmed = clause.trim();
            if (!trimmed) return null;
            const start = currentStart;
            const end = start + clause.length;
            currentStart = end + 2;
            return { text: trimmed, start, end: Math.min(end, text.length) };
          })
          .filter(Boolean);
      }
      return [];
    }
  ];
  for (const strategy of strategies) {
    const result = strategy();
    if (result && result.length > 0) return result;
  }
  return [{ text: text.trim(), start: 0, end: text.length }];
}

/* ---------------- Detector Class ---------------- */
class SensitiveTextDetector {
  constructor(engine) {
    this.engine = engine;
    this.attachedInputs = new WeakSet();
    this.activeOverlays = new Map();
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
  }
    

  async classifySentence(sentence) {
    const response = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: this.classificationPrompt },
        { role: "user", content: sentence }
      ],
      temperature: 0.0,
      max_tokens: 10
    });
    const result = response.choices[0].message.content.trim().toLowerCase();
    console.log(`"${sentence}" => ${result}`);
    return result.includes("true");
  }

  async processSentences(text) {
    const sentences = advancedSentenceSplit(text);
    const sensitiveSentences = [];
    const sensitiveRanges = [];
    for (let i = 0; i < sentences.length; i++) {
      const isSensitive = await this.classifySentence(sentences[i].text);
      if (isSensitive) {
        sensitiveSentences.push(sentences[i].text);
        sensitiveRanges.push({ start: sentences[i].start, end: sentences[i].end });
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    return { sensitiveSentences, sensitiveRanges };
  }

  highlightSensitiveTextCSS(inputEl, sensitiveRanges) {
    // Remove old overlays
    this.removeOverlaysForInput(inputEl);
    if (!sensitiveRanges.length) return;

    const text = inputEl.value || inputEl.textContent;
    const rect = inputEl.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:absolute;top:${rect.top + window.scrollY}px;left:${rect.left + window.scrollX}px;
      width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:9999;
      font-family:${window.getComputedStyle(inputEl).fontFamily};
      font-size:${window.getComputedStyle(inputEl).fontSize};
      white-space:pre-wrap;overflow:hidden;color:transparent;
    `;
    let html = "";
    let idx = 0;
    sensitiveRanges.forEach((r) => {
      if (idx < r.start)
        html += `<span style="color:transparent;">${this.escapeHtml(text.slice(idx, r.start))}</span>`;
      html += `<span style="background-color:rgba(255,0,0,0.4);color:transparent;">${this.escapeHtml(
        text.slice(r.start, r.end)
      )}</span>`;
      idx = r.end;
    });
    if (idx < text.length)
      html += `<span style="color:transparent;">${this.escapeHtml(text.slice(idx))}</span>`;
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    this.activeOverlays.set(inputEl, overlay);

    // Warning bubble
    const warning = document.createElement("div");
    warning.textContent = `⚠️ ${sensitiveRanges.length} sensitive part(s)`;
    warning.style.cssText = `
      position:absolute;top:${rect.top + window.scrollY - 24}px;left:${rect.left}px;
      background:red;color:white;padding:2px 6px;border-radius:4px;font-size:12px;z-index:10000;
    `;
    document.body.appendChild(warning);
    setTimeout(() => warning.remove(), 4000);
  }

  removeOverlaysForInput(inputEl) {
    const overlay = this.activeOverlays.get(inputEl);
    if (overlay) overlay.remove();
    this.activeOverlays.delete(inputEl);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  attachToInput(inputEl) {
  if (this.attachedInputs.has(inputEl)) return;
  this.attachedInputs.add(inputEl);

  let timer;
  const detectAndHighlight = async () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const val = inputEl.value ?? inputEl.textContent ?? "";
      if (!val.trim()) {
        inputEl.style.border = "";
        this.removeOverlaysForInput(inputEl);
        
        return;
      }

      const { sensitiveSentences, sensitiveRanges } = await this.processSentences(val);
      if (sensitiveSentences.length > 0) {
        inputEl.style.border = "2px solid red";
        this.highlightSensitiveTextCSS(inputEl, sensitiveRanges);
      } else {
        inputEl.style.border = "";
        this.removeOverlaysForInput(inputEl);
      }
    }, 300);
  };

  inputEl.addEventListener("input", detectAndHighlight);
  inputEl.addEventListener("blur", detectAndHighlight);
  inputEl.addEventListener("paste", () => setTimeout(detectAndHighlight, 100));
  detectAndHighlight();
  
}

  startMonitoring() {
    const observer = new MutationObserver(() => {
      const inputEl =
        document.querySelector("#ask-input") ||
        document.querySelector("textarea") ||
        document.querySelector("input[type='text']");
      if (inputEl) this.attachToInput(inputEl);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const inputEl =
        document.querySelector("#ask-input") ||
        document.querySelector("textarea") ||
        document.querySelector("input[type='text']");
      if (inputEl) this.attachToInput(inputEl);
  }
}

/* ---------------- Bootstrap ---------------- */
(async () => {
  console.log("✅ Content script loaded with highlighting");
  const engine = await CreateMLCEngine(
    "Phi-3.5-mini-instruct-q4f32_1-MLC-1k"
  );
  console.log("✅ Connected to shared WebLLM engine");

  const detector = new SensitiveTextDetector(engine);
  detector.startMonitoring();
})();
