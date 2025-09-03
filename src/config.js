export const classificationPrompt=`Analyze this sentence for sensitive information. Respond with ONLY "true" or "false".

Sensitive information includes:
- Personal names, addresses, phone numbers, email addresses
- Passwords, API keys, tokens, credentials
- Credit card numbers, bank account numbers, SSN
- Personal confessions, secrets, private thoughts
- Financial details, salary information

Examples:
"My name is John Smith" → true
"My password is abc123" → true  
"I confess I cheated on the test" → true
"The weather is nice today" → false
"Let's meet at the coffee shop" → false
"I love pizza" → false

Sentence: `;

