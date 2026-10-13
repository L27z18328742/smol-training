# Export Scripts

Scripts pour exporter l'article dans différents formats.

## Prérequis

```bash
cd app
npm install
npm run build  # Build le site avant export
```

## Commandes

| Format | Commande | Output |
|--------|----------|--------|
| **PDF** | `npm run export:pdf` | `dist/{slug}.pdf` |
| **TXT** | `npm run export:txt` | `dist/{slug}.txt` |
| **DOCX** | `npm run export:docx` | `public/{slug}.docx` |
| **Images** | `npm run export:images` | `screenshots/` |

## Détails

### PDF
Export haute qualité avec liens interactifs, table des matières et numérotation.

```bash
npm run export:pdf
```

### TXT (pour édition livre)
Export texte avec tags personnalisés pour les éléments spéciaux :
- `<f>` figures/images
- `<t>` tableaux  
- `<c>` blocs de code
- `<ic>` code inline
- `<l>` formules LaTeX

```bash
npm run export:txt
```

Voir [README-TXT-EXPORT.md](./README-TXT-EXPORT.md) pour le détail des tags.

### DOCX
Convertit le TXT en document Word. Lancer après `export:txt`.

```bash
npm run export:txt && npm run export:docx
```

### Images/Screenshots
Exporte tous les éléments visuels (graphiques, tableaux, formules) en PNG haute résolution (4x).

```bash
npm run export:images
```

Output dans `screenshots/` avec noms basés sur les IDs des éléments.

## Workflow complet

```bash
# Export tout
npm run build
npm run export:pdf
npm run export:txt
npm run export:docx
npm run export:images
```
