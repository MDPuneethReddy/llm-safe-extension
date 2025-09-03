  export const MAX_CHARS = 200; 
  export function splitIntoSentences(text) {
  const sentences = [];
  
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

// Split a sentence into chunks if too long
export function chunkSentence(sentenceObj, maxChars = MAX_CHARS) {
  const chunks = [];
  const text = sentenceObj.text;
  if (text.length <= maxChars) {
    return [sentenceObj];
  }

  let startIdx = 0;
  while (startIdx < text.length) {
    const endIdx = Math.min(startIdx + maxChars, text.length);
    chunks.push({
      text: text.slice(startIdx, endIdx),
      start: sentenceObj.start + startIdx,
      end: sentenceObj.start + endIdx
    });
    startIdx += maxChars;
  }

  return chunks;
}