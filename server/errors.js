// Business-rule errors (shown to the user as 400). Anything else is a server error (500).
export class BizError extends Error {}
