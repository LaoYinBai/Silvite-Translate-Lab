// JSON supplies a single data envelope; escaping angle brackets also prevents
// source text from creating literal boundary tags or chat-role lookalikes.
// This preserves the decoded text and is not a substitute for model policy.
export function serializeTranslationData(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
