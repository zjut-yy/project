# vis 项目总览（持续更新）

> 最后更新：2026-05-07  
> 维护方式：后续对该项目的新理解、结构变化、关键问题、数据流调整，统一继续更新这一个文件。

## 1. 项目定位

当前判断：`/home/yangyu/MiniCPM-S/vis` 是一个面向**监控视频 / 多摄像头场景**的可视化与分析项目，不只是视频播放，而是把**视频、轨迹、检测框、交互事件、相机视角**组织成一个可交互的时空分析系统。

从现有代码看，项目包含两层核心能力：

1. **后端分析与场景服务**：扫描场景、读取轨迹/视频、执行分析、提供 API。
2. **前端时空可视化**：把轨迹、对象、相机图像、相机视锥、时间线等映射到 2D/3D/FPS 视图中展示。

---

## 2. 目录总览

| 路径 | 作用判断 |
| --- | --- |
| [backend/](backend/) | Python 后端、API、数据集读取、分析逻辑、模型接入 |
| [frontend/](frontend/) | 前端相关代码 |
| [frontend/SpaceTimeCube/](frontend/SpaceTimeCube/) | 核心时空立方体可视化模块 |
| [assets/](assets/) | 静态资源 |
| [logs/](logs/) | 运行日志 |
| [main.py](main.py) | 当前为空文件，暂未承担实际入口职责 |

当前更像是**后端主导 + 前端可视化模块独立演进**的结构。

---

## 3. 后端梳理

### 3.1 运行入口

- 前端目前的单页原型入口是： [frontend/SpaceTimeCube/virat_102_cube_deck.html](frontend/SpaceTimeCube/virat_102_cube_deck.html)
- 当前已完成第一轮低风险整理：
  - HTML 壳文件只保留 DOM 结构与外链引用；
  - CSS 已拆分为 [base.css](frontend/SpaceTimeCube/base.css)、[semantic-panels.css](frontend/SpaceTimeCube/semantic-panels.css)、[event-cards.css](frontend/SpaceTimeCube/event-cards.css)、[xy-panel.css](frontend/SpaceTimeCube/xy-panel.css)；
  - JS 当前以 [stc-app.js](frontend/SpaceTimeCube/stc-app.js) 为主运行脚本；
  - 第二轮低风险拆分已完成两块： [stc-utils.js](frontend/SpaceTimeCube/stc-utils.js)（工具函数）与 [stc-renderers.js](frontend/SpaceTimeCube/stc-renderers.js)（渲染逻辑）。

这意味着当前目录结构已经从“超大单文件 HTML”过渡到“壳 HTML + 分组 CSS + 多文件 JS”的可维护状态，后续继续拆 `selection / deck / data / agent` 会更稳。

### 3.2 API 路由

当前已确认的主要接口：

- `POST /query`：通用查询分析
- `POST /analyze_video`：视频分析
- `GET /health`：健康检查
- `GET /virat/scenes`：列出可用场景
- `GET /virat/scenes/{scene_id}`：获取单个场景
- `POST /virat/analyze`：对场景执行文本分析

对应文件： [backend/api/routes.py](backend/api/routes.py)

### 3.3 核心服务文件

核心逻辑集中在： [backend/services/query_service.py](backend/services/query_service.py)

当前确认的重要函数：

- `handle_query(...)`
- `handle_analyze_video(...)`
- `health_status()`
- `list_scenes()`
- `get_scene(scene_id)`
- `analyze_scene(...)`

这说明后端已经把“场景读取”和“分析查询”统一收口到一个服务层里。

### 3.4 数据集扫描与场景组织

场景扫描逻辑在： [backend/dataset/scene_loader.py](backend/dataset/scene_loader.py)

当前已确认支持：

- **VIRAT**
- **WildTrack**

扫描逻辑会整理出：

- `scene_id`
- `dataset_type`
- `video_path`
- `tracks_path`
- `duration`
- `fps`
- `frame_count`
- `camera_id`（WildTrack）

这说明后端已经把不同数据集尽量统一到同一种“场景”抽象上，便于前端消费。

### 3.5 模型与分析能力

从目录和启动说明看，后端接入了多种模型/推理能力：

- [backend/model/Qwen2.5-7B-Instruct/](backend/model/Qwen2.5-7B-Instruct/)
- [backend/model/InternVideo2.5/](backend/model/InternVideo2.5/)
- [backend/model/TimeChat-7b/](backend/model/TimeChat-7b/)
- [backend/agent_internvideo_server.py](backend/agent_internvideo_server.py)
- [backend/services/garbage_video_pipeline.py](backend/services/garbage_video_pipeline.py)

启动说明见： [backend/STARTUP_GUIDE.md](backend/STARTUP_GUIDE.md)

目前的判断是：

- `vLLM` 负责提供模型服务（文档中为 8001）
- `agent_internvideo_server.py` 负责代理/分析服务（文档中为 8010）
- `query_service.py` 里仍然通过 `_legacy()` 依赖旧服务模块，说明当前处于**新接口壳 + 旧核心逻辑并存**的状态
- `garbage_video_pipeline.py` 是独立的视频到视频垃圾检测管线：按采样帧调用 AIhubmix 兼容 OpenAI 接口的视觉模型，返回 `bbox + label + score`，并重新渲染出带框与类别的视频

---

## 4. 前端可视化梳理

### 4.1 核心可视化模块

核心组件： [frontend/SpaceTimeCube/index.tsx](frontend/SpaceTimeCube/index.tsx)

从实现看，这个组件不是简单的视频播放器，而是一个**Space-Time Cube（时空立方体）可视化容器**，负责把多类数据组合成 deck.gl 图层。

### 4.2 技术栈判断

从代码可确认：

- React
- TypeScript
- deck.gl

例如 `index.tsx` 中直接使用了：

- `DeckGL`
- `OrbitView`
- Redux 风格的 `useAppSelector / useAppDispatch`

这说明它大概率是嵌入到一个更大的 React 应用中的可视化子模块。

### 4.3 当前支持的视图模式

视图配置位于： [frontend/SpaceTimeCube/config.ts](frontend/SpaceTimeCube/config.ts)

当前确认支持三种模式：

- `2d`：鸟瞰视角
- `3d`：斜视三维视角
- `fps`：第一视角跟随模式

`fps` 模式会跟随当前帧的自车位姿实时调整视角，而 `2d / 3d` 会围绕当前目标位置或场景中心进行更新。

### 4.4 当前支持的主要图层

从 [frontend/SpaceTimeCube/index.tsx](frontend/SpaceTimeCube/index.tsx) 与 [frontend/SpaceTimeCube/config.ts](frontend/SpaceTimeCube/config.ts) 看，当前可视化至少包含：

- 地图图层（divider / boundary / drivable area / ped crossing）
- 轨迹图层
- 当前帧对象图层（GT）
- 预测对象图层
- 对象轨迹图层
- 相机图片图层
- 相机视锥图层
- 自车状态墙
- 指标墙
- 检测时间线墙
- 前视相机墙
- 选中对象轨迹高亮

这表明项目目标并不是单视角显示，而是把**空间、时间、对象、相机、指标**同时放进同一分析空间里。

---

## 5. 前端数据处理链路

### 5.1 轨迹 / 对象 / 地图 到 3D 数据

关键文件： [frontend/SpaceTimeCube/hooks/useSTCData.ts](frontend/SpaceTimeCube/hooks/useSTCData.ts)

已确认这个文件负责把原始数据转换为可渲染的 STC 数据：

- `useSTCTrajectoryPoints(...)`：轨迹点转 3D
- `useSTCCurrentFrameObjects(...)`：当前帧对象转 3D
- `useSTCObjectTracks(...)`：同一对象跨帧轨迹
- `useSTCMapData(...)`：静态地图转底平面元素

这里还能看到一个明显的坐标转换设计：

- 使用 `swapPointXY(...)`
- 使用 `swapHeadingForSwappedXY(...)`

说明前端在渲染前做过统一坐标系适配。

### 5.2 相机图片加载

关键文件： [frontend/SpaceTimeCube/hooks/useLoadCameraImages.ts](frontend/SpaceTimeCube/hooks/useLoadCameraImages.ts)

当前可确认有三类加载策略：

- `useLoadCameraImages()`：加载当前帧相机图
- `useLoadCameraImagesWithPreload(preloadRange)`：加载当前帧及邻近帧
- `useLoadFrontCameraImagesAll()`：为前视相机墙批量加载全时序前视图像

这部分说明项目很重视**时间浏览体验**和**多帧连续观察**。

### 5.3 相机空间表达

已看到与相机相关的可视化组成包括：

- 相机图像面片
- 相机视锥体
- 前视相机墙

从功能设计上看，这是在把“视频帧”从传统 2D 播放界面中释放出来，直接投放到 3D 分析场景中。

---

## 6. 当前理解的数据流

基于现有代码，先记录一个当前版本的数据流：

1. 后端扫描 VIRAT / WildTrack 数据集，组织成场景列表。
2. 前端/调用方通过 API 获取某个场景的元数据、视频路径、轨迹数据、相机数据。
3. 当前场景数据进入前端状态管理（从代码看应是 Redux store）。
4. `SpaceTimeCube` 从 store 中读取：
   - `sceneMetadata`
   - `staticMap`
   - `gtStream`
   - `predictionStream`
   - `associations`
   - `currentFrameIndex`
5. 各类 hooks 将原始数据转换为 deck.gl 所需图层数据。
6. `index.tsx` 调用多个 `create*Layers(...)` 方法，把图层组合后交给 `DeckGL` 渲染。

这个链路说明项目主线是：

**场景数据 -> 结构化时空对象 -> 多图层叠加 -> 交互分析视图**

---

## 7. 启动与运行方式

启动说明见： [backend/STARTUP_GUIDE.md](backend/STARTUP_GUIDE.md)

当前已知运行结构：

- 模型服务：`vLLM`（文档中默认 8001）
- 代理/分析服务：`agent_internvideo_server.py`（文档中默认 8010）
- 快速启动脚本： [backend/start_all_services.sh](backend/start_all_services.sh)
- vLLM 启动脚本： [backend/start_vllm_server.sh](backend/start_vllm_server.sh)

当前目录中也能看到实际数据集与模型文件，说明这不是空壳，而是带本地数据/模型的运行型项目。

---

## 8. 当前观察到的问题与待确认点

### 8.1 已观察到的问题

1. **项目根目录的 `main.py` 为空文件**  
   说明实际入口已经转移到 `backend/main.py`，根文件暂时没有承担职责。

2. **`frontend/SpaceTimeCube/app/src` 基本为空**  
   当前没有看到一个完整、独立可运行的前端工程结构，更像是“可视化组件目录 + 残留壳目录”。

3. **`SpaceTimeCube` 目录下未看到明确的前端构建配置**  
   当前没有在该目录内找到可用的 `package.json`、`vite.config.*`、`tsconfig.json` 等源码级配置文件（排除了 `node_modules` 后）。说明该模块可能：
   - 被其他前端工程引用；或
   - 处在迁移/拆分过程中；或
   - 当前仓库只保留了组件层代码。

4. **前视相机墙的启用判断较临时**  
   在 `useLoadFrontCameraImagesAll()` 中，是否启用前视相机墙目前是通过 `metadata` 是否存在来简化判断，而不是直接绑定图层开关状态。

5. **后端仍依赖 legacy 模块**  
   `query_service.py` 和 `scene_loader.py` 都通过 `_legacy()` 引用旧服务模块，说明服务层还没有彻底解耦。

6. **`track_fusion_cache` 目前对“无交互（none）”存在系统性偏置**  
   当前缓存目录里的 279 个融合结果全部是正交互标签，没有任何 `none`。代码层面有三个直接原因：
   - Qwen 融合提示词要求 `fused_type` 必须从 8 个正交互枚举中选择，没有把 `none` 放进提示词枚举；
   - `_save_track_fusion_cache(...)` 只会在 Qwen 融合结果 `ok=True` 时写缓存，而该成功路径要求存在有效类型、置信度大于 0、且存在有效时间段；
   - `_fill_fused_interaction_fields(...)` 只会把融合结果映射成顶层交互字段，当 `fused_type` 属于正交互枚举且 `confidence > 0` 时才会填充，因此融合层天然更容易只留下“有交互”结果。
   这意味着当前 `track_fusion_cache` 更像是“成功交互融合缓存”，而不是“所有融合判定结果（包括 none）”的完整记录。

7. **项目迁移到 `/lv_home` 后存在路径敏感问题**  
   已确认项目目前依赖 `/home/yangyu/MiniCPM-S -> /lv_home/yangyu/MiniCPM-S` 软链接维持兼容，但仍有两类隐患：
   - 启动脚本曾把项目根目录硬编码为 `/home/yangyu/MiniCPM-S`；
   - `query_service.py` 中部分缓存 key 与旧缓存匹配逻辑直接使用 `str(tracks_path)` 或旧 `meta.tracks_path` 做字符串比较，迁移后会因为 `/home/...` 与 `/lv_home/...` 不一致而造成缓存失配。
   当前已修复：
   - [backend/start_all_services.sh](backend/start_all_services.sh) 与 [backend/start_vllm_server.sh](backend/start_vllm_server.sh) 现在基于脚本自身位置推导目录，不再依赖旧硬编码根路径；
   - [backend/services/query_service.py](backend/services/query_service.py) 现在会先规范化路径再比较，并对 `track_text_events` 增加旧 `/home/...` digest 缓存回退。

8. **框选后的摘要层需要承担“交互对象推断”职责**  
   当前系统存在一个关键局限：大模型经常只能识别“某条轨迹存在交互行为”，但无法把交互对象可靠地对齐到另一条具体轨迹。例如它可能输出“目标与穿黑色夹克的男性擦肩而过”，但并不知道“穿黑夹克的男性”是轨迹 18 还是轨迹 21。  
   因此框选后的摘要层不应只是重复事件卡，而应承担**交互对象推断层**的职责：
   - 以模型明确输出交互行为的轨迹实例作为“交互种子节点”；
   - 在同一时间窗内，根据时空邻近性为其查找候选交互对象；
   - 明确区分：
     - **双向确认**：两条轨迹都被模型判为存在同类交互；
     - **单向确认 + 邻近补全**：只有一条轨迹被模型判定，另一条是时空邻近候选；
     - **弱候选**：仅邻近但证据较弱；
   - 通过节点/边的样式区分“模型明确输出”和“系统根据时空关系补全的候选”。

   这个设计借鉴了 ActiVis / What-If Tool / DeepCompare / LSTMVis / M2Lens 一类系统的共同思路：先做集合级选择，再把局部关系显性化；但这里进一步强调的是**交互对象对应关系的可推断性**，而不是普通统计摘要。

### 8.2 待继续确认的问题

1. 前端真正的宿主应用在哪里。
2. `currentScene` / `playback` / `camera` 这些 Redux slice 的完整定义在哪里。
3. `predictionStream` 和 `associations` 的上游生成链路。
4. 文本查询如何驱动监控事件筛选、目标高亮和交互类型判定。
5. WildTrack 多摄像头与 3D 视图之间的具体配准细节。

---

## 9. 当前阶段的项目判断

现阶段我对这个项目的判断是：

> 这是一个把监控/多摄像头视频场景、对象轨迹、检测/预测结果、相机图像和高层事件分析统一到同一个时空可视分析界面中的系统。

它的重点不只是“看视频”，而是：

- 看对象如何在空间中运动
- 看不同摄像头如何共同描述同一场景
- 看事件/交互如何在时间上展开
- 看模型分析结果如何与真实轨迹/检测结果对照

---

## 10. 后续维护约定

后续继续看这个项目时，优先把新信息更新到本文件，包括但不限于：

- 新确认的模块职责
- 真实的前后端挂载关系
- 数据字段定义
- 接口返回结构
- 可视化交互设计
- 已修复/待修复问题
- 启动流程变化

建议后续采用以下追加方式：

- 若是**结构性理解**变化：直接更新对应章节
- 若是**新发现问题**：补到“当前观察到的问题与待确认点”
- 若是**重要阶段结论**：补到“更新记录”

---

## 11. 更新记录

- **2026-05-12**：完成 `/home/yangyu/MiniCPM-S -> /lv_home/yangyu/MiniCPM-S` 迁移核查，确认前端当前实际通过 `http-server` 提供 [vis/](.)，场景服务端口为 8010，vLLM 端口为 8001。
- **2026-05-12**：定位前端“加载场景列表”异常不是接口故障，而是 [frontend/SpaceTimeCube/virat_102_cube_deck.html](frontend/SpaceTimeCube/virat_102_cube_deck.html) 曾被截断，导致初始化脚本不完整；随后已从 VS Code 本地历史恢复到较新的完整版本。
- **2026-05-12**：修复迁移后的路径敏感问题：启动脚本改为基于脚本目录推导路径；`query_service.py` 的缓存 key 与旧缓存匹配改为基于规范化路径处理，并为 `track_text_events` 增加旧 `/home/...` digest 回退，以兼容迁移前生成的缓存文件（例如 `wildtrack_fused_7cams_8fc7aced2f.json`）。
- **2026-05-13**：确定框选后的摘要层不再只是“事件汇总”，而是承担“交互对象推断层”职责：用交互种子节点 + 候选对象节点 + 关系边，区分双向确认、单向确认+邻近补全、弱候选三类关系，帮助用户从时空邻近关系中判断交互究竟发生在哪两条轨迹之间。
