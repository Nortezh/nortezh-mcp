// Nothing gets created, changed or deleted until the guidance has been delivered.
//
// The guidance lives in an MCP prompt, which is user-invoked only — the model has no
// prompts/get, so a plain "deploy this to nortezh" runs with none of it in context. That is
// not hypothetical: a real run on a build containing every rule still built an image locally
// and pushed it with the laptop's docker credential, because the slash command was never
// typed. Adding a `deployGuide` tool improves the odds but does not close it — the model
// still has to choose to call it, and the whole problem is a model that did not.
//
// So the last mutating call before any guidance has landed does not happen. It comes back as
// a tool error carrying the guidance itself, and the model retries with it in context. It
// cannot be missed, because it is not advice: the call genuinely did not run.
//
// Deliberately NOT a permission system. It fires once per process and never blocks the same
// call twice — the goal is that the rules are in context before infrastructure changes, not
// to police what happens after.
export class GuideGate {
    options;
    delivered = false;
    constructor(options) {
        this.options = options;
    }
    /**
     * Records that the guidance reached the model by some other route — the user invoking the
     * prompt, or the model calling `deployGuide` itself. Either way there is nothing left to
     * teach, so the next write proceeds.
     */
    markDelivered() {
        this.delivered = true;
    }
    /** True once the guidance has been delivered by any route. */
    get satisfied() {
        return this.delivered;
    }
    /**
     * Returns the text to serve INSTEAD of running a tool, or null to let it run.
     *
     * Read-only tools are never gated: `projectList`, `deploymentGet` and the metrics routes
     * change nothing, and blocking them would make the inventory step of the very procedure
     * being taught impossible.
     */
    check(tool) {
        if (!this.options.enabled)
            return null;
        if (this.delivered)
            return null;
        if (tool.readOnly)
            return null;
        // Mark before returning: the guidance is in this response, so the retry must go through.
        // Leaving it unset would block the retry too and loop forever.
        this.delivered = true;
        return [
            '⚠️ STOP — this call did NOT run.',
            '',
            'It is the first change to infrastructure in this session, and the guidance below had',
            'not been read yet. Read it, then make the call again.',
            '',
            'This happens once per session. Read-only calls are never blocked.',
            '',
            '='.repeat(78),
            '',
            this.options.guidance,
        ].join('\n');
    }
}
//# sourceMappingURL=guide-gate.js.map