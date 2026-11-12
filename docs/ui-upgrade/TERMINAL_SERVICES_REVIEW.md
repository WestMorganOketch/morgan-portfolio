# Hero-terminal service proof-link review

Prepared for owner review before attaching project proof links to the hero-terminal service panels. No repo link should be displayed as proof unless the relationship is obvious and the owner confirms it. Private repositories are excluded. GitHub's public metadata showed no topics for the listed repositories.

| Public non-fork repository | Description from GitHub metadata | Language | Topics | URL | Proposed service mapping |
|---|---|---|---|---|---|
| SQL-SALES-ANALYSIS | Not set in metadata; README currently describes a Kenya public-debt/economic-sustainability Power BI analysis, which does not match the repository name. | TSQL | None listed | https://github.com/WestMorganOketch/SQL-SALES-ANALYSIS | No mapping to Pentesting/Web. Owner should resolve the name/README mismatch before considering a link. |
| Kenya-Debt-Analysis | Not set in metadata; README describes Kenya public-debt and economic-sustainability analysis using Power BI, DAX, and data modeling. | Not reported | None listed | https://github.com/WestMorganOketch/Kenya-Debt-Analysis | No direct Pentesting/Web service match. Keep unlinked in the terminal. |
| HOUSE-PRICE-PREDICTION-USING-LINEAR-REGRESSION | Not set in metadata; README currently describes customer-churn prediction using logistic regression rather than house-price prediction. | Jupyter Notebook | None listed | https://github.com/WestMorganOketch/HOUSE-PRICE-PREDICTION-USING-LINEAR-REGRESSION | No direct Pentesting/Web service match. Owner should review the README/repository-name mismatch. |
| customer-churn-prediction | Not set in metadata; repository content endpoint reports the repository is empty. | Not reported | None listed | https://github.com/WestMorganOketch/customer-churn-prediction | No mapping; don't link an empty repository as proof. |
| churn-logistic-regression | Not set in metadata; README documents a customer-churn classification notebook using Logistic Regression, pandas, and scikit-learn. | Jupyter Notebook | None listed | https://github.com/WestMorganOketch/churn-logistic-regression | Data/ML work, not a direct Pentesting/Web service match. Keep unlinked in this terminal. |
| DECISION-TREE-FOR-CUSTOMER-CHURN-PREDICTION | Not set in metadata; README describes a customer-churn Decision Tree notebook. | Jupyter Notebook | None listed | https://github.com/WestMorganOketch/DECISION-TREE-FOR-CUSTOMER-CHURN-PREDICTION | Data/ML work, not a direct Pentesting/Web service match. Keep unlinked in this terminal. |
| Logistic-Regression-Students-Performance- | Not set in metadata; README contains only the project heading. | Not reported | None listed | https://github.com/WestMorganOketch/Logistic-Regression-Students-Performance- | Insufficient README detail to establish a service mapping. Do not link it as proof yet. |
| DBSCAN-For-Mall-Customer-Segmentation.ipynb | Not set in metadata; README describes DBSCAN segmentation of mall-customer data using Python and scikit-learn. | Jupyter Notebook | None listed | https://github.com/WestMorganOketch/DBSCAN-For-Mall-Customer-Segmentation.ipynb | Data/ML work, not a direct Pentesting/Web service match. Keep unlinked in this terminal. |
| morgan-portfolio | Not set in metadata; README describes Morgan's public-facing cybersecurity/IT support/data portfolio and its responsive web design. | JavaScript | None listed | https://github.com/WestMorganOketch/morgan-portfolio | **Direct match for the Web development service**: the repository is the portfolio application itself. A proof link is currently shown on that service. Confirm it is okay to use as the representative web-development repository. |
| cybersecurity-learning-portfolio | A collection of cybersecurity learning notes, defensive security cheat sheets, and practical reference materials covering networking, web security, Linux, Windows, SOC analysis, and threat intelligence. | Not reported | None listed | https://github.com/WestMorganOketch/cybersecurity-learning-portfolio | Possible learning-resource reference for cybersecurity education after owner review, but it does not prove tutoring/client work or a specific assessment. No proof link added. |

## Existing project evidence reviewed separately

The portfolio's existing project data includes **Secure VPN Deployment** and **Secure Web Application Development**. I did not find an unambiguous matching public repository in the repository metadata above, so neither project is linked as proof from the terminal. Do not infer proof from a similar title alone.

## Current terminal mapping proposal

| Terminal service | Evidence decision |
|---|---|
| Cybersecurity tutoring | No public proof link. The cybersecurity-learning repository is reference material, not evidence of tutoring or client outcomes. |
| Web development | `morgan-portfolio` only; direct repository/site relationship. |
| Web application security testing | No public proof link. No directly matching public repository was established. |

Every service in `client/src/content/terminal.ts` remains marked `// OWNER TO CONFIRM`. This document is a review proposal, not a certification of work, client relationship, or result.

## Data collection and limits

The GitHub username was read from the site's existing profile link: `WestMorganOketch`. The requested one-shot unauthenticated call from the development machine to:

`https://api.github.com/users/WestMorganOketch/repos?per_page=100&sort=updated`

could not be run in this environment: there was no local repository checkout, the shell could not resolve `github.com`, and the connected GitHub fetch endpoint does not allow that user-repository-list URL. To avoid inventing repo details, the table was assembled from a connected read-only public repository listing and individual public-repository metadata/README reads. It includes the 10 public, non-fork repositories surfaced by the connected listing and excludes the private `oketch` repository. No visitor-browser GitHub request or runtime fetch was added to the terminal, and no GitHub token was added to source.
