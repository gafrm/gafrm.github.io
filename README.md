# Quarto Academic Website Template

Welcome! This is a simple and customizable template for building your own academic website using [Quarto](https://quarto.org/). You can easily fork, edit, and publish your site with just a few steps.

## 🚀 Quick Start

1. **Star** this repository to bookmark it for future reference.  
1. **Fork** this repository and rename it to `YourGitHubUserName.github.io`.  
1. **Test to publish** your site using [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-from-a-branch) (make sure [configuring](https://quarto.org/docs/publishing/images/gh-pages-docs-dir.png) your GitHub repository to publish from the `docs` directory, not the `root` folder). 
1. **Check** if your website works or not. If successful, you should see exactly the same website as [this one](https://drganghe.github.io/quarto-academic-website-template/) using your own Github Pages url:
   - `https://YourGitHubUserName.github.io` if your repository name is `YourGitHubUserName.github.io`
   - `https://YourGitHubUserName.github.io/RepositoryName` for other `RepositoryName`
   - Errors:
      - If [404](/files/images/Error1.png), it is likely you haven't set up GitHub Pages
      - If it shows the [README](/files/images/Error2.png) file, it is likely you've published from the `root` folder, not the `docs` directory

If you achieve this milestone, congratulations! You are now ready to start updating your website:

1. **Update** the `_quarto.yml` file to configure your site’s basic settings.  
1. **Add or edit content** in the following files and folders:
   - `/posts/` – posts about publications, news, events  
   - `teaching.qmd` – teaching information  
   - `projects.yml` – research or other projects  
   - `people.qmd` and `/people/` – team or collaborators  
   - `/files/` - profiles, images, pdfs, and includes 
1. [**Render and preview**](https://quarto.org/docs/websites/#website-preview) your site locally.  
1. **`Commit` to publish** your updates.
1. **Refine and polish** your content and design as needed.  
1. ✅ Enjoy your new website!
1. **Link** your website on your official pages to let Google and AI bots include in their search results.


## Automatically Generate a Neat Publication List

1. **Prepare your publication source file**:
   - Recommended: maintain `publications.xlsx` (already supported by this template, you can convert a bib file to Excel using online tools).
2. **Fill `publications.xlsx` using the expected column names**:
   - `Section`, `Authors`, `Year`, `Date`, `Title`, `Paper Link`, `Journal`, `Volume`, `Issue`, `Pages`, `DOI`
   - Optional links/metadata: `PDF`, `Preprint`, `ShareIt`, `Supplemental Information`, `GitHub`, `Code`, `Data`
   - Optional flags/info: `Highly Cited`, `Hot Paper`, `Awards`, `Media Coverage`, `Invited Presentation`, `Categories`
3. **Install Python dependency** (one-time):
   - `pip install openpyxl`
   - Optional validation support: `pip install pyyaml`
4. **Convert Excel to YAML**:
   - `python xlsx_to_yml.py`
   - Or with custom files: `python xlsx_to_yml.py input.xlsx output.yml`
   - Force conversion: `python xlsx_to_yml.py --force`
5. **Render your site**:
   - `quarto render`
   - The project is already configured with `pre-render: python xlsx_to_yml.py` in `_quarto.yml`, so conversion will run automatically before rendering if there is any update in `publications.xlsx`.
6. **Check publication page output**:
   - Main auto-generated page: `pub-listing.qmd`
   - Listing template: `pub-listing.ejs`
   - Styling: `pub-listing.css`
   - Filter: The `remove-stray-divfence.lua` filter is added to remove excessive ::: in html after rendering.
7. **Categorize records correctly**:
   - Use `Section` as either `Selected Work` or `Peer-reviewed Journal Paper` to place entries into corresponding sections. You can add other Section as needed.
   - Use `Categories` with separators like `,`, `;`, or `|` for listing filters.
8. **Publish changes**:
   - Enjoy your neat automatically generated publication list. You can customize style and template if you need to add new links and flags.


## 🛠 Requirements

- Install [Quarto](https://quarto.org/docs/get-started/)
- Learn the basics from the [official Quarto documentation](https://quarto.org/docs/websites/)

## 📚 More Examples & Tips

- [Quarto Academic Site Examples and Tips](https://drganghe.github.io/quarto-academic-site-examples.html)