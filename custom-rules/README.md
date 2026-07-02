# Custom Rule Packs

Put local rule pack JSON files here, then add the file or directory path to `customRules` in `minecraft-log-resolver.config.json`.

See `docs/custom-rules.md` for the full rule format and workflow.

Validate before scanning:

```bash
npm run rules:validate -- --rule-file custom-rules
```

The `examples` directory is not enabled by default.
