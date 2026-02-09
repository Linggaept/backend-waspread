
try {
  const { GoogleAIFileManager } = require("@google/generative-ai/server");
  console.log("Import successful");
} catch (e) {
  console.error("Import failed:", e.message);
}
