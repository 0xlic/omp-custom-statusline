# OMP Custom Statusline

为 [Oh My Pi](https://github.com/can1357/oh-my-pi) 状态栏添加当前目录和当前模型供应商的剩余用量。

## 效果

GPT / Gemini：

```text
 tmp · 5h:18% / 7d:46%
```

DeepSeek：

```text
 tmp · ¥21.12
```

## 支持的模型供应商

- OpenAI GPT（`openai-codex`）
- Google Gemini（`google-antigravity`、`google-gemini-cli`）
- DeepSeek（`deepseek`）

状态栏只显示当前模型供应商的用量。使用 `/switch` 或 `Ctrl+P` 切换模型后，会自动刷新对应供应商的数据。

## 安装

```bash
git clone https://github.com/0xlic/omp-custom-statusline.git
cd omp-custom-statusline
omp install .
```

安装完成后重新启动 OMP。

## 数据来源

- GPT 和 Gemini：读取 `omp usage --json`。
- DeepSeek：调用 DeepSeek 余额接口，优先读取 `DEEPSEEK_API_KEY`，否则使用 `omp token deepseek` 获取凭据。

## 刷新频率

默认每 60 秒刷新一次。切换模型时会立即刷新。

可通过环境变量调整定时刷新间隔，最小值为 30 秒：

```bash
export OMP_CUSTOM_STATUSLINE_REFRESH_MS=30000
```

## 开发

```bash
bun install
bun test
bun run check
```
