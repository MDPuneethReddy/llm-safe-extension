const script = document.createElement("script");
script.src = chrome.runtime.getURL("webllm.bundle.js");
script.type = "text/javascript";
script.onload = () => {
  console.log("WebLLM injected");

  // Try waiting and checking
  setTimeout(() => {
    if (window.webllm) {
      console.log("WebLLM is now available:", window.webllm);
    } else {
      console.warn("WebLLM still undefined");
    }
  }, 1000);
};
(document.head || document.documentElement).appendChild(script);

