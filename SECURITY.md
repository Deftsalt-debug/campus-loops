# Security

Campus Loops is a static browser application. There is no server, account system, or route database receiving visitor input. Saved plans and calibration logs stay in browser storage; map tiles and Google Maps links involve the third parties described in the README.

## Reporting an issue

Use the repository's **Security → Report a vulnerability** option when it is available: [security reporting](https://github.com/Deftsalt-debug/campus-loops/security). Include the affected commit or deployed URL, browser, steps to reproduce, and the impact. Avoid including personal route links or exported walk logs unless necessary, and remove private details first.

If private reporting is unavailable, open a public issue asking the maintainer for a private reporting channel. Do not include exploit details in that initial issue.

## Maintenance

Dependency updates are proposed by Dependabot. Pull requests and main releases run lint, typechecking, tests, a production build, dataset checks, and `npm audit --audit-level=high`. An audit cannot establish that an application is free of vulnerabilities; dependency changes and browser-facing code still need review.

Only the deployment job receives Pages and OIDC write permissions. Pull-request code runs with a read-only repository token and does not deploy. Maintainers should enable private vulnerability reporting, dependency alerts, branch protection, and a required verification check in repository settings.
