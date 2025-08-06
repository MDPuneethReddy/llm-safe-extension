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
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function highlightSensitiveText(inputDiv, sensitiveSentences) {
  const allText = inputDiv.innerText;
  const sentences = allText.split(/(?<=\.)\s+/);

  const highlightedHTML = sentences
    .map(sentence => {
      if (sensitiveSentences.some(sen => sen.trim() === sentence.trim())) {
        return `<span style="background-color: rgba(255,0,0,0.3);">${escapeHtml(sentence)}</span>`;
      } else {
        return escapeHtml(sentence);
      }
    })
    .join(" ");

  inputDiv.innerHTML = highlightedHTML;
}
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

 const systemPrompt = `You are a content filter. When given a message, respond with only "SAFE" or "SENSITIVE".
A message is SENSITIVE if it contains:
- Personal data (SSNs, emails, phone numbers)
- API keys or tokens
- Production credentials or URLs
- Confessions of illegal or unethical behavior
Otherwise, respond with SAFE.`;

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

  function attachListener(inputDiv) {
  let typingTimer; // timer identifier
  const doneTypingInterval = 700; // wait 700ms after user stops typing

  inputDiv.addEventListener("input", () => {
    clearTimeout(typingTimer);

    typingTimer = setTimeout(async () => {
      const text = inputDiv.innerText.trim();
      console.log("User stopped typing, input:", text);

      if (!text) {
        inputDiv.style.border = "";
        inputDiv.title = "";
        inputDiv.innerHTML = escapeHtml(text);
        return;
      }

      try {
        // fresh chat for each input detection
        const response = await engine.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
        });

        console.log("Full response:", response);

        const verdict = response.choices[0].message.content.trim();
        let sensitiveSentences = [];

        if (verdict.toUpperCase().includes("SENSITIVE")) {
          // Here you might want to improve how you extract sentences
          // For now, highlight entire input as sensitive or specific sentences if available
          sensitiveSentences = [text]; // simple: highlight whole text
          highlightSensitiveText(inputDiv, sensitiveSentences);
          inputDiv.style.border = "2px solid red";
          inputDiv.title = "⚠️ Warning: Sensitive info detected";
        } else {
          inputDiv.style.border = "";
          inputDiv.title = "";
          // remove highlights, keep plain text
          inputDiv.innerHTML = escapeHtml(text);
        }
      } catch (err) {
        console.error("❌ Error during chat processing:", err);
      }
    }, doneTypingInterval);
  });
  }
})();