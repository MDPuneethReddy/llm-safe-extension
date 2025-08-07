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

const systemPrompt = `You are a content filter. When given a message, respond ONLY with a JSON array of sentences that meet one or both of these criteria:

1. The sentence is a clear confession of a serious illegal act that could lead to jail or criminal prosecution (e.g., theft, assault, tax evasion, murder, fraud, etc). DO NOT include ambiguous or trivial statements like "I am not a good boy".
2. The sentence contains personal data or sensitive information, such as:
   - Phone numbers
   - Social Security Numbers (SSNs)
   - Mobile numbers
   - API keys or tokens
   - Production credentials or URLs
   - Email addresses

Return an empty array if there are no such sentences.

Example input: "I am not a good boy. My API key is abc123. I didn't do taxes. I killed someone. My phone number is 555-123-4567."
Expected output: ["My API key is abc123.", "I didn't do taxes.", "I killed someone.", "My phone number is 555-123-4567."]

Example input: "I am a good boy. I love my dog."
Expected output: []
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
  const doneTypingInterval = 300;

  const processInput = () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(async () => {
      const text = inputDiv.textContent.trim();
      console.log("User stopped typing, input:", text);

      if (!text) {
        inputDiv.style.border = "";
        inputDiv.title = "";
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
        } else {
          console.log("No sensitive/confession sentences detected.");
          inputDiv.style.border = "";
          inputDiv.title = "";
        }
      } catch (err) {
        console.error("❌ Error during chat processing:", err);
      }
    }, doneTypingInterval);
  };

  inputDiv.addEventListener("input", processInput);
  inputDiv.addEventListener("blur", processInput);
  inputDiv.addEventListener("paste", () => {
    setTimeout(processInput, 0); // Wait for paste to complete
  });
inputDiv.addEventListener("keyup", processInput); 
  // Process existing text immediately after attaching
  processInput();
}
})();