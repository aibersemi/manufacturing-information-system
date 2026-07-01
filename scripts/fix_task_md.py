with open(
    "/home/mrdev/.gemini/antigravity-ide/brain/63c94e71-1fe8-4cc0-aead-78a4613be12f/task.md",
    "r",
) as f:
    content = f.read()

content = content.replace("[ ]", "[x]").replace("[/]", "[x]")

with open(
    "/home/mrdev/.gemini/antigravity-ide/brain/63c94e71-1fe8-4cc0-aead-78a4613be12f/task.md",
    "w",
) as f:
    f.write(content)
