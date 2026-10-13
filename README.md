# Smol 训练手册 · 简体中文版

HuggingFaceTB《The Smol Training Playbook: The Secrets to Building World-Class LLMs》的非官方简体中文全译本。正文按原文逐段翻译，保留原站交互布局，并参考同级 `rlhf-book-zh-tw` 项目的中文阅读配色与字体。参考项目未作任何修改。

## 阅读

在本目录运行：

```sh
./run.sh
```

然后打开 <http://127.0.0.1:8765>。也可以用 `./run.sh 8766` 更换端口。网页需要通过本地 HTTP 服务打开，不能直接双击 HTML 来运行全部交互图表。

原问题中的章节：<http://127.0.0.1:8765/#understanding-what-works-evaluation>。

支持章节目录、手机阅读、明暗主题、阅读进度、打印，以及保留当前章节位置的英文原文切换。

## 内容与校验

- 覆盖 2,550 个提取单元（含 3 个保留的 HTML 文档声明），没有待翻译单元。
- 保留原书 1,150 个正文段落、27 张表格、72 处旁注、21 张图片、91 个交互嵌入实例。
- 49 个代码／图示代码块、157 个数学公式和 144 条参考文献条目通过原文一致性检查。
- 修复原书若干旧章节锚点及偏好优化链接的显示问题。
- 中文为 AI 分段翻译，经术语、数字与长段落抽查及全量结构检查；尚未经过原作者或外部专家的逐句审校。
- 代码、数学符号、参考文献条目和图片中的文字保留原文。交互图表常用标签已本地汉化，模型、数据集及算法标识保留。
- 7 个外部交互工具沿用原站界面，需要网络连接；图表库、正文图片与本地数据已保存到项目中。

完整检查结果见 `translation/quality-report.json` 与 `translation/browser-report.json`。

## 文件

- `webapp/index.html`：中文版网页；`webapp/original.html`：英文阅读页。
- `webapp/reader.css`、`reader.js`：中文阅读样式及工具。
- `translation/source-units.json`：逐段英文原文及稳定编号。
- `translation/manual.json`、`part-*.json`：逐段中文译文。
- `translation/chart-labels.json`：交互图表显示文本词典。
- `translation/original.html`：未修改的英文页面快照。
- `source/`：上游源项目快照与构建资源。
- `scripts/build_book.py`、`verify_book.py`：从译文重新生成并核对网页。

现有环境重新构建：

```sh
.venv/bin/python scripts/build_book.py
.venv/bin/python scripts/verify_book.py
```

如需在新环境构建，使用 Python 3.9+，创建虚拟环境并安装 `beautifulsoup4`。构建不会调用翻译服务。

## 来源与许可

原作者：Loubna Ben Allal、Lewis Tunstall、Nouamane Tazi、Elie Bakouch、Ed Beeching、Carlos Miguel Patiño、Clémentine Fourrier、Thibaud Frere、Anton Lozhkov、Colin Raffel、Leandro von Werra、Thomas Wolf（Hugging Face）。

原书：<https://huggingface.co/spaces/HuggingFaceTB/smol-training-playbook>

上游版本：`179c71bb4a1c10c8be98768dea04fbc2cfc8e9f9`，下载日期 2026-09-08。原文页面标注发布日期为 2025-10-30，部分正文包含后续更新；译文沿用该快照，不把年份统一改写。

原文与译文依 CC BY 4.0 使用，见 `LICENSE`。原站第三方图片与依赖仍遵循各自许可。本项目新增中文翻译、显示文本汉化、阅读样式与链接修复；不暗示原作者认可或审核本译本。
