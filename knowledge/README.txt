HOW TO USE THIS FOLDER
======================

Drop your company documents here, then run: node rag-sync.mjs

Supported formats:
- .pptx  (PowerPoint — just save/copy the file here)
- .docx  (Word document)
- .txt   (plain text)
- .md    (markdown)

Tips:
- One file per topic works best (e.g. "dxn-products.pptx", "company-overview.txt")
- Re-run rag-sync.mjs every time you add or update a file
- Refresh the dashboard browser tab to load the updated knowledge base

PREDEFINED Q&A (exact answers)
===============================

For questions you want answered with a specific, exact answer (instead of
the bot guessing from general documents), edit predefined-qa.txt in this
folder using this format:

  Q: Who are the members of the Create Greater DXN team?
  A: ...the answer...

  Q: Who is Jesstine Soliven?
  A: ...the answer...

Rules:
- Each pair starts with a line beginning "Q:" followed by a line beginning "A:"
- Answers can span multiple lines — any line that doesn't start with "Q:" is
  treated as a continuation of the current answer
- Separate pairs with a blank line
- You don't need to phrase questions exactly — the bot matches based on
  meaning, so rephrased versions of the question will still find the
  predefined answer

After editing predefined-qa.txt, run: node qa-sync.mjs
(this is separate from rag-sync.mjs and does not need Google Drive/API keys
for Drive — only the OpenAI key in config.json)
