# Mandatory Automated Testing and Empirical Verification

## Core Rule
For all bug fixes, features, and configuration changes in this workspace:
1. **Never declare success without empirical evidence**: Editing files or explaining logic is not enough.
2. **Automated Test Generation**: Create or run dedicated test scripts (`tests/verify_*.ps1` or `tests/*.test.js`) that simulate real runtime conditions (e.g., HTTP preflight, status code fallback, database connection, authentication response parsing).
3. **Report Concrete Logs**: Output and present exact test execution logs showing pass/fail status, HTTP status codes, and validated response fields.
