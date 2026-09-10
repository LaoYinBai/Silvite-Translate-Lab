# Silvite 文档翻译实施计划

1. 先写运行时路径与配置测试，迁移 handler/Prompt，更新本地脚本与旧路径引用。
2. 先写分块器测试，实现语言感知、Markdown/段落/句子优先和硬切兜底。
3. 先写文档管线测试，实现逐块请求、局部重试、95 秒软截止细分、顺序组装和进度。
4. 安装浏览器解析依赖；先写文件 parser 测试，再实现 TXT/MD/DOCX/PDF 校验与提取。
5. 先写 JSON 边界回归测试，再收紧服务端 parser 与流式 extractor。
6. 先写 store 竞态测试，再统一 generation/abort 生命周期并接入文件状态和长文进度。
7. 在现有 InputArea/ResultArea 中最小增加“文件”入口、文件摘要和自然进度文案。
8. 更新 README、DEV、环境变量示例和架构路径。
9. 运行全部自动化检查，制作本地 fixtures，在真实浏览器完成桌面/移动及长文/文件人工验收。
10. 检查 diff 与工作树，使用 conventional commit 提交并推送 `main`。
