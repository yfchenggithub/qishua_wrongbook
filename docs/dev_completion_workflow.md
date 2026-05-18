# 开发完成固定流程

每次开发完成后，统一执行以下收尾检查：

```bash
npm run preflight
```

`preflight` 会按顺序执行：

1. `npm run check:encoding`
2. `npm run typecheck`
3. `npm run lint`

说明：

- 任意一步失败都会立即停止并返回非 0，必须先修复再继续。
- 提交前的 `pre-commit` 仍会执行暂存区编码守卫，和本流程互补。
