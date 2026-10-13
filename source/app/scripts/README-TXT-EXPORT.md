# TXT Export for Book Publishing

This script exports the article to a simple text format suitable for book publishing software, with custom tags for special elements.

## Usage

```bash
npm run export:txt
```

Or with custom filename:

```bash
node scripts/export-txt.mjs --filename=my-article
```

## Output

The script generates a `.txt` file in the `dist/` folder with the following format:

### Text Tags

#### Figures/Images
```
<f> NAME ANCHOR DESCRIPTION </f>
```
- **NAME**: Figure name (e.g., "Figure 1")
- **ANCHOR**: HTML anchor/ID for cross-references
- **DESCRIPTION**: Figure caption/description

Example:
```
<f>Figure 1 placeholder-image A placeholder image description</f>
```

#### Tables
```
<t> NAME DESCRIPTION </t>
```
- **NAME**: Table name (e.g., "Table 1")
- **DESCRIPTION**: Table caption/description

Example:
```
<t>Table 1 | Comparison of model architectures</t>
```

#### Code Blocks
```
<c> CODE | DESCRIPTION </c>
```
- **CODE**: The actual code content
- **DESCRIPTION**: Optional description or caption

Example:
```
<c>function hello() {
  console.log("Hello world");
} | JavaScript example function</c>
```

#### Inline Code
```
<ic> CODE </ic>
```
Example:
```
Use the <ic>npm install</ic> command to install dependencies.
```

#### LaTeX Formulas
```
<l> katex-number </l>
```
References to exported KaTeX formula PNGs, numbered chronologically.

Example:
```
The equation <l>katex-1</l> shows the relationship...
```

The corresponding PNG files should be exported separately (e.g., `katex-1.png`, `katex-2.png`, etc.)

## Standard Markdown Elements

The script also preserves standard markdown formatting:

- **Headings**: `# ## ###` etc.
- **Paragraphs**: Plain text with line breaks
- **Lists**: Bulleted (`-`) and numbered (`1. 2. 3.`)
- **Blockquotes**: `> Text`

## How It Works

1. **Build**: Builds the Astro site (if not already built)
2. **Launch**: Starts a preview server
3. **Extract**: Uses Playwright to load the page and extract content from the DOM
4. **Convert**: Transforms HTML elements into the custom tag format
5. **Export**: Writes the result to `dist/article.txt`

## Example Output

```
# Introduction

This is a paragraph with <ic>inline code</ic> and a reference to <l>katex-1</l>.

<f>Figure 1 training-loss Training loss over time for SmolLM3</f>

## Methods

We used the following approach:

- First step
- Second step  
- Third step

<c>def train_model():
    return model | Python training function</c>

<t>Table 1 | Hyperparameters used in training</t>
```

## Notes

- The script reuses the same infrastructure as PDF export (`export-pdf.mjs`)
- It's designed to work with the existing Astro build pipeline
- All custom components (Image, HtmlEmbed, Note, etc.) are properly handled
- KaTeX formulas are numbered sequentially for easy reference to exported PNGs
