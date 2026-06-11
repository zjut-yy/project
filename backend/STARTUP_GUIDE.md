# MiniCPM-S 视觉系统启动指南

## 问题诊断

### vLLM启动错误
```
ImportError: /lib/x86_64-linux-gnu/libstdc++.so.6: version `CXXABI_1.3.15' not found
```

**原因**: 系统的libstdc++版本过旧，vLLM环境中需要更新的版本

**解决方案**: 设置`LD_LIBRARY_PATH`优先加载虚拟环境中的C++库

---

## 快速启动

### 方式1: 启动所有服务（推荐）

```bash
/home/yangyu/vis/backend/start_all_services.sh
```

此脚本会：
1. 启动vLLM OpenAI API服务器 (端口 8001)
2. 启动MiniCPM-S代理服务器 (端口 8010)
3. 自动处理库版本问题
4. 显示各服务运行信息

### 方式2: 单独启动vLLM服务

```bash
/home/yangyu/vis/backend/start_vllm_server.sh
```

然后在另一个终端启动代理服务：
```bash
export LD_LIBRARY_PATH="/home/yangyu/ENTER/envs/minicpm/lib:$LD_LIBRARY_PATH"
export VLLM_URL="http://localhost:8001/v1"
export AGENT_PORT="8010"
cd /home/yangyu/vis/backend
python3 agent_internvideo_server.py
```

### 方式3: 完整命令行启动

**启动vLLM**:
```bash
export LD_LIBRARY_PATH="/home/yangyu/ENTER/envs/vllm/lib:$LD_LIBRARY_PATH"
cd /home/yangyu/vis/backend/model
python3 -m vllm.entrypoints.openai.api_server \
  --model ./Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8001 \
  --gpu-memory-utilization 0.5 \
  --max-model-len 4096 \
  --dtype float16
```

**启动代理服务**（新终端）:
```bash
export LD_LIBRARY_PATH="/home/yangyu/ENTER/envs/minicpm/lib:$LD_LIBRARY_PATH"
export VLLM_URL="http://localhost:8001/v1"
export AGENT_PORT="8010"
cd /home/yangyu/vis/backend
python3 agent_internvideo_server.py
```

---

## 验证服务运行

### 检查端口

```bash
# 检查vLLM服务
curl http://localhost:8001/health

# 检查代理服务
curl http://localhost:8010/health
```

### 列出可用的视频场景

```bash
curl http://localhost:8010/virat/scenes | jq .
```

### 分析场景

```bash
curl -X POST http://localhost:8010/virat/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "scene_id": "WildTrack_C1",
    "text": "显示所有行人"
  }'
```

---

## 支持的数据集

| 数据集 | 场景数 | 类型 | 帧数 |
|--------|--------|------|------|
| VIRAT | 7 | 视频+标注 | 变化 |
| WildTrack | 7 | 多摄像头轨迹 | 400/摄像头 |

### WildTrack场景ID
- `WildTrack_C1` - 摄像头1 (8,732个检测)
- `WildTrack_C2` - 摄像头2 (7,978个检测)
- `WildTrack_C3` - 摄像头3 (6,703个检测)
- `WildTrack_C4` - 摄像头4 (2,240个检测)
- `WildTrack_C5` - 摄像头5 (3,924个检测)
- `WildTrack_C6` - 摄像头6 (9,413个检测)
- `WildTrack_C7` - 摄像头7 (3,731个检测)

---

## 日志和调试

### 查看服务日志

启动All Services脚本后，日志位置：
- vLLM日志: `/home/yangyu/vis/logs/vllm_server.log`
- 代理日志: `/home/yangyu/vis/logs/agent_server.log`

```bash
# 实时查看vLLM日志
tail -f /home/yangyu/vis/logs/vllm_server.log

# 实时查看代理日志
tail -f /home/yangyu/vis/logs/agent_server.log
```

### 诊断库版本问题

```bash
# 检查系统libstdc++
strings /lib/x86_64-linux-gnu/libstdc++.so.6 | grep CXXABI_1.3 | tail -5

# 检查虚拟环境libstdc++
strings /home/yangyu/ENTER/envs/vllm/lib/libstdc++.so.6 | grep CXXABI_1.3 | tail -5
```

---

## 关闭服务

### 使用启动脚本关闭
按 `Ctrl+C` 脚本会自动关闭所有服务

### 手动关闭
```bash
# 杀死vLLM进程
pkill -f "vllm.entrypoints.openai"

# 杀死代理进程
pkill -f "agent_internvideo_server"
```

---

## 环境配置参考

### vLLM环境
- 位置: `/home/yangyu/ENTER/envs/vllm`
- Python版本: 3.10
- libstdc++: libstdc++.so.6.0.34

### MiniCPM环境
- 位置: `/home/yangyu/ENTER/envs/minicpm`
- Python版本: 3.10
- 包含依赖: torch, PIL, transformers, decord

### 项目位置
- 项目根目录: `/home/yangyu`
- 后端代码: `/home/yangyu/vis/backend`
- 模型目录: `/home/yangyu/vis/backend/model`
- 数据集:
  - VIRAT: `/home/yangyu/vis/backend/dataset/VIRAT`
  - WildTrack: `/home/yangyu/vis/backend/dataset/WildTrack_VIRAT`

---

## 常见问题

### Q: 启动时提示"无法找到模型"
A: 确保模型在正确位置：
```bash
ls -la /home/yangyu/vis/backend/model/Qwen2.5-7B-Instruct/config.json
```

### Q: vLLM启动缓慢
A: 这是正常的，模型加载需要时间。参考脚本中的等待时间（15秒）。

### Q: 代理服务显示"vLLM连接失败"
A: 确保vLLM已完全启动。检查日志：
```bash
tail -f /home/yangyu/vis/logs/vllm_server.log | grep "Uvicorn running"
```

### Q: 数据集没有被发现
A: 对于WildTrack，需要先运行转换脚本：
```bash
cd /home/yangyu/vis/backend/dataset
python3 convert_wildtrack_to_virat.py
```

---

## API参考

### 获取所有场景
```
GET /virat/scenes
```

返回所有可用VIRAT和WildTrack场景。

### 获取某个场景详情
```
GET /virat/scenes/{scene_id}
```

示例:
```bash
curl http://localhost:8010/virat/scenes/WildTrack_C1
```

### 分析场景
```
POST /virat/analyze
```

body:
```json
{
  "scene_id": "WildTrack_C1",
  "text": "显示所有行人",
  "time_start": 0,
  "time_end": 100
}
```

---

## 更多信息

- WildTrack集成文档: `/home/yangyu/vis/backend/dataset/README_WildTrack_Integration.md`
- 转换脚本: `/home/yangyu/vis/backend/dataset/convert_wildtrack_to_virat.py`
