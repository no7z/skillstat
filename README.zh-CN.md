# skillstat

[English](README.md) | **中文**

**审计你的 Claude Code skills。** 你装了几十个 agent skill,但哪些是真在用的?哪些是死重——每个会话都被悄悄注入 context、白白吃掉 token?`skillstat` 读取你本地的 Claude Code 会话记录并告诉你答案,再帮你一键瘦身。

- 🔍 **真实使用数据,不靠猜** — 解析 `~/.claude` 会话记录,统计每个 skill 实际触发了多少次、最近一次是什么时候、在哪些项目里。
- 💸 **Context 成本** — 估算 skill 清单每个会话注入多少 token,其中有多少花在了你从不使用的 skill 上。
- ✂️ **可逆瘦身** — 把闲置 skill 移到 `skills-disabled/`,随时一条命令还原。
- 🔒 **纯本地、不烧 token** — 确定性解析,没有任何数据离开你的机器,不调用模型,运行本身不花一个 token。

```
$ skillstat cost
skillstat cost  (skill_listing context overhead, estimated)

METRIC                          VALUE
Skills offered per session        121
Installed skills (disk)           128
Idle offered skills (>30d)        116
Skill-listing tokens / session  ~3.9k
  ↳ wasted on idle skills       ~3.7k
Sessions analyzed                  38

121 个 offered skill 里有 116 个 ≥30 天没触发过,每个会话为此浪费约 3.7k token。
```

## 安装

```bash
npm install -g skillstat
# 或者不安装直接跑:
npx skillstat
```

需要 Node ≥ 18,无其他依赖。

### 当作 agent skill 使用

skillstat 自带一份 `SKILL.md`,所以你的编码 agent 能直接帮你跑——只要问一句
*"我哪些 skill 是真在用的?"* 或 *"是什么把我的 context 撑满了?"*,它就会自动挑对应的子命令。

```bash
# Claude Code / Codex / Cursor(兼容 Agent Skills 标准):
npx skills add no7z/skillstat
```

也可以手动放:把本仓库的 `SKILL.md` 复制到 `~/.claude/skills/skillstat/SKILL.md`
(Claude Code)或 `~/.codex/skills/…`(Codex)。之后用 `/skillstat` 显式调用,
或让它根据描述自动触发。这个 skill 只是去调 `skillstat` CLI,所以请保持 CLI 已安装
(否则它会回退到 `npx`)。

## 用法

```bash
skillstat                    # scan:每个 skill 的触发次数(默认命令)
skillstat scan --all         # 连从未触发过的 offered skill 一起列出
skillstat cost               # 闲置 skill 吃掉了多少 context?
skillstat report -o r.html   # 生成自包含 HTML 报告(离线、可分享)
skillstat slim --days 60     # 归档闲置 60 天以上的 skill(会先确认)
skillstat slim --restore     # 撤销:把归档的 skill 移回来
```

### 命令

| 命令 | 作用 |
|------|------|
| `scan`   | 列出每个 skill:触发次数、显式 vs 自动激活、最近触发时间、涉及项目。 |
| `cost`   | 估算 `skill_listing` 每会话的 token 开销,以及其中浪费在闲置 skill 上的比例。 |
| `report` | 生成一份自包含的暗色 HTML 仪表盘(双击即开,无需服务器)。 |
| `slim`   | 把闲置的**用户** skill(绝不动插件)移到 `~/.claude/skills-disabled/`。可逆(`--restore`),移动前会确认。 |

### 选项

| 参数 | 含义 |
|------|------|
| `-d, --days <n>` | "僵尸" skill 的闲置天数阈值(默认 30)。 |
| `-a, --all` | `scan`:同时列出从未触发过的 offered skill。 |
| `-o, --out <f>` | `report`:输出路径(默认 `skillstat-report.html`)。 |
| `-y, --yes` | `slim`:跳过确认提示。 |
| `--restore` | `slim`:把 `skills-disabled/` 里的所有 skill 移回 `skills/`。 |
| `--json` | `scan` 和 `cost` 的机器可读输出。 |

## 工作原理

每个 Claude Code 会话都会记录成 `~/.claude/projects/` 下的一个 JSONL 文件。
skillstat 遍历这些文件,统计两种触发信号:

- **explicit(显式)** — 一次 `Skill` 工具调用(你打了 `/skill-name`,或 agent 主动调用),
- **auto(自动)** — 一个 `invoked_skills` attachment(skill 根据描述匹配被自动激活)。

计算 context 成本时,它读取每个会话注入的 `skill_listing` attachment 并估算其 token
大小(启发式,不用 tokenizer——保持零依赖、离线)。已安装的 skill 从 `~/.claude/skills/`
和 `~/.claude/plugins/` 中发现。

设置 `CLAUDE_CONFIG_DIR` 可指向非默认的配置目录。

### 注意事项

- Token 数字是**估算值**(基于字符数/词数启发式),用于相对比较,不用于计费。
- 会话记录格式是 Claude Code 的内部细节,不是公开 API,未来版本可能改字段名。
  skillstat 会优雅降级(跳过无法解析的行)而非崩溃。
- `slim` 只会动 `~/.claude/skills/` 下的 skill——插件提供的 skill 是只读的,永远不会被移动。

## 许可证

MIT
