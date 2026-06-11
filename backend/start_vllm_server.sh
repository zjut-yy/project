#!/bin/bash
# vLLM OpenAI API Server启动脚本
# 用于解决libstdc++版本不匹配问题

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_DIR="$SCRIPT_DIR/model"

# 配置
VLLM_ENV="/home/yangyu/ENTER/envs/vllm"
MODEL_NAME="Qwen2.5-7B-Instruct"

# 检查环境
if [ ! -d "$VLLM_ENV" ]; then
    echo "✗ vLLM环境不存在: $VLLM_ENV"
    exit 1
fi

if [ ! -d "$MODEL_DIR/$MODEL_NAME" ]; then
    echo "✗ 模型不存在: $MODEL_DIR/$MODEL_NAME"
    exit 1
fi

# 设置环境变量以解决libstdc++版本不匹配
export LD_LIBRARY_PATH="$VLLM_ENV/lib:$LD_LIBRARY_PATH"

echo "================================"
echo "启动 vLLM OpenAI API 服务器"
echo "================================"
echo "Model: $MODEL_NAME"
echo "Port: 8001"
echo ""

# 启动服务器
cd "$MODEL_DIR"
python3 -m vllm.entrypoints.openai.api_server \
  --model "./$MODEL_NAME" \
  --host 0.0.0.0 \
  --port 8001 \
  --gpu-memory-utilization 0.5 \
  --max-model-len 4096 \
  --dtype float16
