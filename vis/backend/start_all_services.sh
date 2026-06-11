#!/bin/bash
# 启动MiniCPM-S视觉系统的完整服务
# 包括vLLM服务器和代理服务器

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$VIS_DIR/.." && pwd)"

# 配置
VLLM_ENV="/home/yangyu/ENTER/envs/vllm"
MINICPM_ENV="/home/yangyu/ENTER/envs/minicpm"
BACKEND_DIR="$SCRIPT_DIR"
MODEL_DIR="$BACKEND_DIR/model"
MODEL_NAME="Qwen2.5-7B-Instruct"

# 日志目录
LOG_DIR="$VIS_DIR/logs"
mkdir -p "$LOG_DIR"

VLLM_LOG="$LOG_DIR/vllm_server.log"
AGENT_LOG="$LOG_DIR/agent_server.log"
PID_FILE="$LOG_DIR/pids.txt"

# 清理函数
cleanup() {
    echo ""
    echo "================================================"
    echo "关闭服务器..."
    echo "================================================"

    if [ -f "$PID_FILE" ]; then
        while IFS= read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                echo "停止进程 $pid..."
                kill "$pid" 2>/dev/null || true
                sleep 1
                kill -9 "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm "$PID_FILE"
    fi

    echo "✓ 已关闭所有服务"
}

# 设置Ctrl+C处理
trap cleanup INT TERM

echo "================================================"
echo "MiniCPM-S 视觉系统启动脚本"
echo "================================================"
echo ""

# 1. 启动vLLM服务器
echo "1️⃣  启动 vLLM OpenAI API 服务器..."
echo "   Port: 8001"

export LD_LIBRARY_PATH="$VLLM_ENV/lib:$LD_LIBRARY_PATH"

cd "$MODEL_DIR"
python3 -m vllm.entrypoints.openai.api_server \
  --model "./$MODEL_NAME" \
  --host 0.0.0.0 \
  --port 8001 \
  --gpu-memory-utilization 0.5 \
  --max-model-len 4096 \
  --dtype float16 \
  > "$VLLM_LOG" 2>&1 &

VLLM_PID=$!
echo "$VLLM_PID" > "$PID_FILE"
echo "   PID: $VLLM_PID"
echo "   等待服务器启动..."
sleep 15

# 2. 启动代理服务器
echo ""
echo "2️⃣  启动 MiniCPM-S 代理服务器..."
echo "   Port: 8010"

cd "$BACKEND_DIR"
export VLLM_URL="http://localhost:8001/v1"
export AGENT_PORT="8010"
export LD_LIBRARY_PATH="$MINICPM_ENV/lib:$LD_LIBRARY_PATH"

python3 agent_internvideo_server.py \
  > "$AGENT_LOG" 2>&1 &

AGENT_PID=$!
echo "$AGENT_PID" >> "$PID_FILE"
echo "   PID: $AGENT_PID"
sleep 3

# 3. 显示启动信息
echo ""
echo "================================================"
echo "✓ 服务已启动"
echo "================================================"
echo ""
echo "vLLM API 服务器:"
echo "  • URL: http://localhost:8001"
echo "  • PID: $VLLM_PID"
echo ""
echo "MiniCPM-S 代理服务器:"
echo "  • URL: http://localhost:8010"
echo "  • PID: $AGENT_PID"
echo ""
echo "API 端点:"
echo "  • 列出场景: GET http://localhost:8010/virat/scenes"
echo "  • 查询场景: GET http://localhost:8010/virat/scenes/{scene_id}"
echo "  • 分析场景: POST http://localhost:8010/virat/analyze"
echo ""
echo "支持的数据集:"
echo "  • VIRAT (7个场景)"
echo "  • WildTrack (7个摄像头视图)"
echo ""
echo "日志位置: $LOG_DIR"
echo "按 Ctrl+C 关闭所有服务"
echo "================================================"
echo ""

# 保持脚本运行
wait
