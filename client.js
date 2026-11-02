/**
 * dsh-system-view — Client half.
 *
 * Registers, entirely in the browser:
 *   1. a `conversation.view` slot entry — the "系统 / System" tab beside
 *      Chat and Trajectory,
 *   2. two Conversation event Definitions over the plugin's own `systemView`
 *      target that fold durable `system/message` and `request/header` events
 *      into prompt / tool / config / context-window snapshots, and
 *   3. one `uiSession` standard hook so the tab component subscribes to the
 *      per-session target snapshot.
 *
 * Nothing here touches a model request: every displayed value derives from
 * session events the harness already records (model-visible <=> log-
 * reconstructable).
 *
 * Bundle format: a closure factory registered on window.__ModuleLoader__,
 * externals resolved through the injected require. Externals used:
 * `react` (hooks) and `react/jsx-runtime`.
 *
 * @module dsh-system-view/client
 */
window.__ModuleLoader__.load({
	id: "dsh-system-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { useEffect, useRef, useState } = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");

		//#region dictionaries
		/** Locale namespace owned by this plugin. */
		const NS = "system-view";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"meta.title": "系统视图",
			"meta.description": "在对话与轨迹旁新增一个系统 Tab，展示当前生效的系统提示词、请求工具与可用 Skills。",
			"view.system": "系统",
			"toolbar.aria": "系统视图工具栏",
			"tab.prompt": "提示词",
			"tab.tools": "工具",
			"tab.skills": "Skills",
			"tab.config": "配置",
			"overview.model": "模型",
			"overview.temperature": "温度",
			"overview.maxTokens": "最大 Token",
			"overview.tools": "工具",
			"overview.skills": "Skills",
			"prompt.updatedAt": "更新于",
			"prompt.copy": "复制",
			"prompt.copied": "已复制",
			"prompt.empty": "尚未生成系统提示词。发送第一条消息后此处展示生效内容。",
			"prompt.exhausted": "会话记录里没有系统提示词。",
			"prompt.inHistoryUpdate": "历史内更新",
			"tools.searchPlaceholder": "搜索工具",
			"tools.parameters": "参数 Schema",
			"tools.noDescription": "（无描述）",
			"tools.empty": "当前请求未附加任何工具。",
			"tools.exhausted": "会话记录里没有请求头。",
			"skills.empty": "系统提示词中没有 <available_skills> 块。",
			"skills.exhausted": "会话记录里没有系统提示词。",
			"skills.rawFallback": "Skill 目录无法解析为列表，展示原始块。",
			"config.provider": "提供商",
			"config.model": "模型",
			"config.purpose": "用途",
			"config.thinking": "思考模式",
			"config.reasoningEffort": "推理力度",
			"config.contextWindow": "上下文窗口",
			"config.temperature": "温度",
			"config.maxTokens": "最大 Token",
			"config.stop": "停止序列",
			"config.adapterDefaults": "适配器默认值",
			"config.raw": "完整配置 JSON",
			"config.empty": "尚未记录请求头。发送第一条消息后此处展示生效配置。",
			"config.exhausted": "会话记录里没有请求头。",
			"history.loading": "正在加载更早的会话日志…",
		};
		/** English dictionary, checked complete against the Chinese source of truth. */
		const en = {
			"meta.title": "System View",
			"meta.description": "Adds a System tab beside Chat and Trajectory showing the effective system prompt, request tools, and available skills.",
			"view.system": "System",
			"toolbar.aria": "System view toolbar",
			"tab.prompt": "Prompt",
			"tab.tools": "Tools",
			"tab.skills": "Skills",
			"tab.config": "Config",
			"overview.model": "Model",
			"overview.temperature": "Temp",
			"overview.maxTokens": "Max tokens",
			"overview.tools": "Tools",
			"overview.skills": "Skills",
			"prompt.updatedAt": "Updated",
			"prompt.copy": "Copy",
			"prompt.copied": "Copied",
			"prompt.empty": "No system prompt is in force yet. Send the first message to generate one.",
			"prompt.exhausted": "No system prompt exists in the session history.",
			"prompt.inHistoryUpdate": "In-history update",
			"tools.searchPlaceholder": "Search tools",
			"tools.parameters": "Parameters",
			"tools.noDescription": "(no description)",
			"tools.empty": "No tools are attached to the current request.",
			"tools.exhausted": "No request header exists in the session history.",
			"skills.empty": "No <available_skills> block found in the system prompt.",
			"skills.exhausted": "No system prompt exists in the session history.",
			"skills.rawFallback": "Skill catalog is not a parseable list; showing the raw block.",
			"config.provider": "Provider",
			"config.model": "Model",
			"config.purpose": "Purpose",
			"config.thinking": "Thinking",
			"config.reasoningEffort": "Reasoning effort",
			"config.contextWindow": "Context window",
			"config.temperature": "Temperature",
			"config.maxTokens": "Max tokens",
			"config.stop": "Stop sequences",
			"config.adapterDefaults": "Adapter defaults",
			"config.raw": "Full config JSON",
			"config.empty": "No request header recorded yet. Send the first message to generate one.",
			"config.exhausted": "No request header exists in the session history.",
			"history.loading": "Loading earlier session history…",
		};
		//#endregion

		//#region prompt-block parsing (pure string math)
		/**
		 * Extract one block from the prompt between a `## <header>` heading and
		 * the next `## ` heading or end of text.
		 * @param {string} prompt full system prompt text.
		 * @param {string} header heading text after `## `, prefix-compared.
		 * @returns {string} block body, or "" when absent.
		 */
		function sectionBlock(prompt, header) {
			const lines = String(prompt ?? "").split("\n");
			const start = lines.findIndex((line) => {
				const match = line.match(/^##\s+(.+?)\s*$/);
				return match !== null && match[1].toLowerCase().startsWith(header.toLowerCase());
			});
			if (start < 0) return "";
			const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
			return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
		}

		/**
		 * Parse the `<available_skills>` block into skill summaries. Tolerates the
		 * shipped `- \`name\`: summary` and bare `- \`name\`` list shapes.
		 * @param {string} prompt full system prompt text.
		 * @returns {{ skills: Array<{ name: string, summary: string }>, raw: string } | null}
		 */
		function parseSkills(prompt) {
			const lines = String(prompt ?? "").split("\n");
			const start = lines.findIndex((line) => line.trim() === "<available_skills>");
			if (start < 0) return null;
			let end = lines.length;
			for (let index = start + 1; index < lines.length; index++) {
				if (lines[index].trim() === "</available_skills>") { end = index; break; }
			}
			const body = lines.slice(start + 1, end);
			const raw = body.join("\n").trim();
			const skills = [];
			for (const line of body) {
				const match = line.match(/^\s*-\s+`([^`]+)`\s*[:：]?\s*(.*)$/);
				if (match === null) continue;
				skills.push({ name: match[1], summary: match[2].trim() });
			}
			return { skills, raw };
		}
		//#endregion

		//#region view snapshot
		/** Empty snapshot, rendered before the first header or prompt exists. */
		const EMPTY_SNAPSHOT = Object.freeze({
			ready: false,
			prompt: "",
			promptTime: 0,
			promptUpdate: false,
			tools: [],
			config: null,
			adapterDefaults: null,
			contextWindow: null,
			skills: null,
			toolCount: 0,
		});

		/**
		 * Incremental per-session builder over the `systemView` node stream.
		 * The assembler delivers complete node sets per transaction, so the fold
		 * is a plain reconstruction; the node count stays tiny (one node per
		 * system-message / request-header event).
		 */
		function createSystemViewBuilder() {
			return {
				empty: EMPTY_SNAPSHOT,
				/** @param {{ nodes: ReadonlyArray<{ seq: number, data: object }> }} input complete node set. */
				replace(input) {
					return fold(input.nodes);
				},
				/** @param {{ upserts: ReadonlyArray<{ seq: number, data: object }>, nodes: ReadonlyArray<{ seq: number, data: object }> }} input. */
				apply(input) {
					return fold(input.nodes);
				},
			};
		}

		/**
		 * Fold the ordered node list into one immutable snapshot.
		 * @param {ReadonlyArray<{ seq: number, data: object }>} nodes ordered target nodes.
		 * @returns {object} view snapshot.
		 */
		function fold(nodes) {
			let prompt = "";
			let promptTime = 0;
			let promptUpdate = false;
			let contextWindow = null;
			let request = null;
			for (const node of nodes ?? []) {
				const data = node?.data;
				if (data === undefined || data === null) continue;
				if (data.kind === "prompt") {
					prompt = typeof data.text === "string" ? data.text : "";
					promptTime = typeof data.time === "number" ? data.time : 0;
					promptUpdate = data.update === true;
				} else if (data.kind === "request-context") {
					contextWindow = typeof data.contextWindow === "number" ? data.contextWindow : null;
				} else if (data.kind === "request") {
					request = data;
				}
			}
			return {
				ready: request !== null || prompt !== "",
				prompt,
				promptTime,
				promptUpdate,
				tools: request !== null && Array.isArray(request.tools)
					? request.tools.slice().sort((a, b) => (a?.name ?? "") < (b?.name ?? "") ? -1 : 1)
					: [],
				config: request?.config ?? null,
				adapterDefaults: request?.adapterDefaults ?? null,
				contextWindow,
				skills: parseSkills(prompt),
				toolCount: request !== null && Array.isArray(request.tools) ? request.tools.length : 0,
			};
		}
		//#endregion

		//#region Conversation Definitions
		/** View target owned by this plugin. */
		const TARGET = "systemView";

		/**
		 * Engine-owned node envelope for this target (mirrors the trajectory helper).
		 * @param {object} context Definition context.
		 * @param {number} anchorSeq ordering sequence.
		 * @param {object} data payload.
		 */
		function systemViewNode(context, anchorSeq, data) {
			return {
				key: context.key,
				kind: context.kind,
				id: context.id,
				target: TARGET,
				anchorSeq,
				location: context.start?.location ?? { kind: "unresolved" },
				data,
			};
		}

		/**
		 * System-prompt Definition: adopts the latest nonempty `system/message`
		 * text as the effective prompt. The shared inspector's uncertain-state
		 * semantics (needed by Trajectory for per-node attribution) would wedge
		 * on replace ops whose earlier endpoint predates the loaded window, but
		 * this tab only needs the current prompt, which each replacement event
		 * carries in full.
		 */
		function systemMessageDefinition() {
			return {
				kind: "systemview-system-message",
				target: TARGET,
				match: (event) => event.type === "system/message" ? { id: String(event.seq), role: "start" } : null,
				start: (_context, match, reader) => {
					const prior = reader.previous("systemview-system-message")?.state;
					const text = match.event.data?.message?.content
						?.filter((block) => block?.type === "text")
						.map((block) => block.text ?? "")
						.join("") ?? "";
					if (text === "") return prior ?? { text: "", time: 0, update: false };
					return { text, time: match.event.time, update: prior !== undefined && prior.text !== "" };
				},
				update: (context) => context.state,
				buildViewNode: (context) => {
					const state = context.state;
					if (state === undefined) return null;
					return systemViewNode(context, context.start?.event.seq ?? 0, {
						kind: "prompt",
						text: state.text ?? "",
						time: state.time ?? 0,
						update: state.update === true,
					});
				},
			};
		}

		/**
		 * Request-header Definition: retains the latest config + tools from the
		 * shared inspector.
		 * @param {(previous: unknown, event: object, system: unknown) => object} inspect pure header inspector from uiConversation.
		 */
		function requestHeaderDefinition(inspect) {
			return {
				kind: "systemview-request-header",
				target: TARGET,
				match: (event) => event.type === "request/header" ? { id: String(event.seq), role: "start" } : null,
				start: (_context, match, reader) => {
					const header = reader.previous("systemview-request-header")?.state;
					const previousPrompt = header?.inspected?.prompt;
					const system = reader.previous("systemview-system-message")?.state?.inspected?.effective;
					const inspection = inspect(previousPrompt, match.event, system);
					const prompt = inspection.prompt;
					return {
						inspected: inspection,
						seq: match.event.seq,
						time: match.event.time,
						config: prompt.config ?? null,
						adapterDefaults: typeof match.event.data?.header?.adapterDefaults === "object" && match.event.data.header.adapterDefaults !== null
							? match.event.data.header.adapterDefaults
							: null,
						tools: prompt.tools ?? [],
					};
				},
				update: (context) => context.state,
				buildViewNode: (context) => {
					const state = context.state;
					if (state === undefined) return null;
					return systemViewNode(context, state.seq, {
						kind: "request",
						seq: state.seq,
						time: state.time,
						config: state.config,
						adapterDefaults: state.adapterDefaults,
						tools: state.tools,
					});
				},
			};
		}

		/**
		 * Request-context Definition: retains the latest contextWindow from
		 * `request/context` events, which the agent loop appends when the
		 * resolved model route metadata changes.
		 */
		function requestContextDefinition() {
			return {
				kind: "systemview-request-context",
				target: TARGET,
				match: (event) => event.type === "request/context" ? { id: String(event.seq), role: "start" } : null,
				start: (_context, match) => ({
					seq: match.event.seq,
					time: match.event.time,
					contextWindow: typeof match.event.data?.contextWindow === "number"
						? match.event.data.contextWindow
						: null,
				}),
				update: (context) => context.state,
				buildViewNode: (context) => {
					const state = context.state;
					if (state === undefined) return null;
					return systemViewNode(context, state.seq, {
						kind: "request-context",
						contextWindow: state.contextWindow,
					});
				},
			};
		}
		//#endregion

		//#region small React helpers (inline styles; no CSS-module dependency)
		/**
		 * Interpolate `{name}` placeholders in a dictionary string.
		 * @param {string} template localized template.
		 * @param {Record<string, string | number>} values substitution values.
		 */
		function format(template, values) {
			return String(template ?? "").replace(/\{(\w+)\}/g, (whole, name) =>
				values !== undefined && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
		}

		/** Case-insensitive contains used by the filter boxes. */
		function contains(haystack, needle) {
			return needle === "" || haystack.toLowerCase().includes(needle.toLowerCase());
		}

		/** Single-value pill used across the overview strip and detail pages. */
		function Pill({ label, value, title }) {
			return jsxs("span", {
				title,
				style: {
					display: "inline-flex", alignItems: "baseline", gap: 4,
					padding: "1px 8px", borderRadius: 999,
					background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14))",
					font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)",
					color: "var(--dsw-alias-label-secondary, inherit)",
					whiteSpace: "nowrap",
				},
				children: [
					label !== undefined && label !== "" ? jsx("span", { style: { opacity: 0.65 }, children: label }) : null,
					jsx("span", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" }, children: value }),
				],
			});
		}

		/** Secondary tab bar of the view. */
		function SubTabs({ tabs, active, onSelect }) {
			return jsx("div", {
				role: "tablist",
				style: {
					display: "flex", gap: 2,
					borderBottom: "0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
					overflowX: "auto", whiteSpace: "nowrap",
				},
				children: tabs.map((tab) => jsx("button", {
					type: "button",
					role: "tab",
					"aria-selected": tab.id === active,
					onClick: () => onSelect(tab.id),
					style: {
						border: 0, background: "transparent", cursor: "pointer",
						padding: "7px 10px", font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)",
						color: tab.id === active
							? "var(--dsw-alias-state-business-primary, #4c6ef5)"
							: "var(--dsw-alias-label-tertiary, inherit)",
						borderBottom: tab.id === active
							? "2px solid var(--dsw-alias-state-business-primary, #4c6ef5)"
							: "2px solid transparent",
					},
					children: tab.label,
				}, tab.id)),
			});
		}

		/** Full-width scroll box for preformatted text with a copy button. */
		function PreBlock({ text, maxHeight, t }) {
			const [copied, setCopied] = useState(false);
			return jsxs("div", {
				style: { position: "relative" },
				children: [
					jsx("button", {
						type: "button",
						onClick: () => {
							void navigator.clipboard?.writeText(text).then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							});
						},
						style: {
							position: "absolute", top: 8, right: 8, zIndex: 1, border: 0, cursor: "pointer",
							padding: "2px 8px", borderRadius: 6,
							background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.2))",
							font: "var(--dsh-font-xs-13, 12px/1.4 sans-serif)",
							color: "var(--dsw-alias-label-secondary, inherit)",
						},
						children: copied ? t("prompt.copied") : t("prompt.copy"),
					}),
					jsx("pre", {
						style: {
							margin: 0, padding: 12, borderRadius: 8,
							overflow: "auto", maxHeight,
							background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10))",
							font: "var(--dsh-font-mono-xs, 12px/1.5 ui-monospace, monospace)",
							color: "var(--dsw-alias-label-primary, inherit)",
							whiteSpace: "pre-wrap", wordBreak: "break-word",
						},
						children: text,
					}),
				],
			});
		}

		/** JSON viewer for tool parameters and config values. */
		function JsonView({ value, t }) {
			return jsx(PreBlock, { text: JSON.stringify(value, null, 2), maxHeight: 320, t });
		}

		/** Simple controlled search input. */
		function SearchBox({ placeholder, value, onChange }) {
			return jsx("input", {
				type: "search",
				value,
				placeholder,
				onChange: (event) => onChange(event.target.value),
				style: {
					width: "100%", boxSizing: "border-box", padding: "6px 10px", borderRadius: 8,
					border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
					background: "transparent",
					font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)",
					color: "var(--dsw-alias-label-primary, inherit)",
					outline: "none",
				},
			});
		}

		/** Empty-state box. */
		function Empty({ text }) {
			return jsx("div", {
				style: {
					padding: "48px 24px", textAlign: "center",
					color: "var(--dsw-alias-label-tertiary, inherit)",
					font: "var(--dsh-font-sm-14, 13px/1.6 sans-serif)",
				},
				children: text,
			});
		}
		//#endregion

		//#region pages
		/** Prompt page: the effective system prompt with match counting and copy. */
		function PromptPage({ snapshot, t, exhausted }) {
			if (snapshot.prompt === "") return jsx(Empty, { text: t(exhausted ? "prompt.exhausted" : "prompt.empty") });
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 },
				children: [
					snapshot.promptUpdate ? jsx(Pill, { value: t("prompt.inHistoryUpdate") }) : null,
					jsx(PreBlock, { text: snapshot.prompt, maxHeight: "calc(100vh - 260px)", t }),
				] });
		}

		/** Tools page: searchable list of the exact request tools with schemas. */
		function ToolsPage({ snapshot, t, exhausted }) {
			const [query, setQuery] = useState("");
			const [open, setOpen] = useState(() => new Set());
			if (snapshot.tools.length === 0) return jsx(Empty, { text: t(exhausted ? "tools.exhausted" : "tools.empty") });
			const filtered = snapshot.tools.filter((tool) =>
				contains(`${tool?.name ?? ""} ${tool?.description ?? ""}`, query));
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 },
				children: [
					jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
						jsx(Pill, { label: t("overview.tools"), value: String(snapshot.toolCount) }),
						jsx("div", { style: { flex: 1, minWidth: 180 }, children: jsx(SearchBox, { placeholder: t("tools.searchPlaceholder"), value: query, onChange: setQuery }) }),
					] }),
					jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: filtered.map((tool) => {
						const name = tool?.name ?? "?";
						const isOpen = open.has(name);
						return jsxs("div", {
							style: {
								border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
								borderRadius: 8, padding: "8px 10px",
							},
							children: [
								jsxs("div", {
									style: { display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" },
									onClick: () => setOpen((previous) => {
										const next = new Set(previous);
										if (next.has(name)) next.delete(name); else next.add(name);
										return next;
									}),
									children: [
										jsx("code", { style: { font: "var(--dsh-font-mono-xs, 12px ui-monospace, monospace)", fontWeight: 600 }, children: name }),
										jsx("span", { style: { flex: 1, color: "var(--dsw-alias-label-secondary, inherit)", font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)" }, children: tool?.description || t("tools.noDescription") }),
										jsx("span", { style: { color: "var(--dsw-alias-label-tertiary, inherit)" }, children: isOpen ? "▾" : "▸" }),
									],
								}),
								isOpen ? jsxs("div", { style: { marginTop: 8 }, children: [
									jsx("div", { style: { font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)", opacity: 0.65, marginBottom: 4 }, children: t("tools.parameters") }),
									jsx(JsonView, { value: tool?.parameters ?? {}, t }),
								] }) : null,
							],
						}, name);
					}) }),
				] });
		}

		/** Skills page: parsed catalog block, raw fallback, or empty state. */
		function SkillsPage({ snapshot, t, exhausted }) {
			const parsed = snapshot.skills;
			if (parsed === null) return jsx(Empty, { text: t(exhausted ? "skills.exhausted" : "skills.empty") });
			if (parsed.skills.length === 0) {
				return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
					jsx("div", { style: { color: "var(--dsw-alias-label-tertiary, inherit)", font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)" }, children: t("skills.rawFallback") }),
					jsx(PreBlock, { text: parsed.raw, maxHeight: 400, t }),
				] });
			}
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
				jsx(Pill, { label: t("overview.skills"), value: String(parsed.skills.length) }),
				jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }, children: parsed.skills.map((skill) => jsxs("div", {
					style: {
						border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
						borderRadius: 8, padding: "8px 10px",
					},
					children: [
						jsx("code", { style: { font: "var(--dsh-font-mono-xs, 12px ui-monospace, monospace)", fontWeight: 600 }, children: skill.name }),
						skill.summary !== "" ? jsx("div", { style: { marginTop: 4, color: "var(--dsw-alias-label-secondary, inherit)", font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)" }, children: skill.summary }) : null,
					],
				}, skill.name)) }),
			] });
		}

		/** Config page: request config rows, adapter defaults, and the raw JSON. */
		function ConfigPage({ snapshot, t, exhausted }) {
			const config = snapshot.config;
			if (config === null || typeof config !== "object") return jsx(Empty, { text: t(exhausted ? "config.exhausted" : "config.empty") });
			const rows = [
				[t("config.provider"), config.provider],
				[t("config.model"), config.model],
				[t("config.purpose"), config.purpose],
				[t("config.thinking"), config.thinking],
				[t("config.reasoningEffort"), config.reasoningEffort],
				...(snapshot.contextWindow !== null ? [[t("config.contextWindow"), snapshot.contextWindow]] : []),
				[t("config.temperature"), config.temperature],
				[t("config.maxTokens"), config.maxTokens],
			].filter(([, value]) => value !== undefined && value !== null && value !== "");
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 },
				children: [
					jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: rows.map(([label, value]) => jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline" }, children: [
						jsx("span", { style: { minWidth: 110, opacity: 0.65, font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)" }, children: label }),
						jsx("code", { style: { font: "var(--dsh-font-mono-xs, 12px ui-monospace, monospace)" }, children: String(value) }),
					] }, label)) }),
					snapshot.adapterDefaults !== null
						? jsxs("div", { children: [
							jsx("div", { style: { opacity: 0.65, font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)", marginBottom: 4 }, children: t("config.adapterDefaults") }),
							jsx(JsonView, { value: snapshot.adapterDefaults, t }),
						] })
						: null,
					config.stop !== undefined && config.stop !== null && config.stop.length > 0
						? jsxs("div", { children: [
							jsx("div", { style: { opacity: 0.65, font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)", marginBottom: 4 }, children: t("config.stop") }),
							jsx(JsonView, { value: config.stop, t }),
						] })
						: null,
					jsxs("div", { children: [
						jsx("div", { style: { opacity: 0.65, font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)", marginBottom: 4 }, children: t("config.raw") }),
						jsx(JsonView, { value: config, t }),
					] }),
				] });
		}

		//#endregion

		//#region the tab component
		/**
		 * The conversation view occupant: overview strip + secondary tabs.
		 * When the session's loaded history window holds no prompt/header yet
		 * (long sessions start paged at the tail), earlier pages are pulled
		 * automatically until the effective context appears or history runs
		 * out. `hasSessionContent` distinguishes an empty conversation from a
		 * truncated history window so the subpages can show the right empty
		 * state once paging is exhausted.
		 */
		function SystemView({ useSystemView, useSession, loadOlder, t }) {
			const snapshot = useSystemView((current) => current ?? EMPTY_SNAPSHOT);
			const [page, setPage] = useState("prompt");
			const [loading, setLoading] = useState(false);
			const sessionState = typeof useSession === "function"
				? useSession((current) => ({
					hasMore: current?.hasMore === true,
					loadingOlder: current?.loadingOlder === true,
					blank: current?.blank === true,
				}))
				: null;
			const hasMore = sessionState?.hasMore === true;
			const sessionLoadingOlder = sessionState?.loadingOlder === true;
			const hasSessionContent = sessionState ? sessionState.blank === false : snapshot.ready;
			const exhausted = hasSessionContent && !snapshot.ready && !hasMore;
			const auto = useRef({ busy: false });
			useEffect(() => {
				if (snapshot.ready || !hasMore || typeof loadOlder !== "function") return;
				const state = auto.current;
				if (state.busy) return;
				state.busy = true;
				setLoading(true);
				Promise.resolve()
					.then(() => loadOlder())
					.catch(() => {})
					.finally(() => {
						state.busy = false;
						setLoading(false);
					});
			}, [snapshot.ready, hasMore, loadOlder]);
			const config = snapshot.config;
			const tabs = [
				{ id: "prompt", label: t("tab.prompt") },
				{ id: "tools", label: `${t("tab.tools")}${snapshot.toolCount > 0 ? ` · ${snapshot.toolCount}` : ""}` },
				{ id: "skills", label: `${t("tab.skills")}${snapshot.skills !== null && snapshot.skills.skills.length > 0 ? ` · ${snapshot.skills.skills.length}` : ""}` },
				{ id: "config", label: t("tab.config") },
			];
			const header = jsxs("div", {
				"aria-label": t("toolbar.aria"),
				style: {
					position: "sticky", top: 0, zIndex: 2,
					padding: "10px 16px 0",
					background: "var(--dsw-alias-bg-base, #fff)",
					boxSizing: "border-box",
				},
				children: [
					!snapshot.ready && (loading || sessionLoadingOlder)
						? jsx("div", { style: { marginBottom: 8, font: "var(--dsh-font-xs-13, 12px/1.5 sans-serif)", color: "var(--dsw-alias-label-tertiary, inherit)" }, children: t("history.loading") })
						: null,
					jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }, children: [
						config !== null ? jsx(Pill, { label: t("overview.model"), value: `${config.provider ?? "?"}/${config.model ?? "?"}` }) : null,
						config?.temperature !== undefined ? jsx(Pill, { label: t("overview.temperature"), value: String(config.temperature) }) : null,
						config?.maxTokens !== undefined ? jsx(Pill, { label: t("overview.maxTokens"), value: String(config.maxTokens) }) : null,
						jsx(Pill, { label: t("overview.tools"), value: String(snapshot.toolCount) }),
						snapshot.skills !== null ? jsx(Pill, { label: t("overview.skills"), value: String(snapshot.skills.skills.length) }) : null,
					] }),
					jsx(SubTabs, { tabs, active: page, onSelect: setPage }),
				],
			});
			return jsxs("div", { style: { boxSizing: "border-box" }, children: [
				header,
				jsxs("div", { style: { padding: "10px 16px 16px" }, children: [
					page === "prompt" ? jsx(PromptPage, { snapshot, t, exhausted }) : null,
					page === "tools" ? jsx(ToolsPage, { snapshot, t, exhausted }) : null,
					page === "skills" ? jsx(SkillsPage, { snapshot, t, exhausted }) : null,
					page === "config" ? jsx(ConfigPage, { snapshot, t, exhausted }) : null,
				] }),
			] });
		}
		//#endregion

		//#region plugin apply
		/** Required client services. `sessions` backs the slot inject factory's loadOlder. */
		const inject = ["locale", "slots", "sessions", "uiSession", "uiConversation"];

		/**
		 * Client plugin body: dictionaries, definitions, hook, and the tab.
		 * @param {object} ctx client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-system-view: dictionaries");
			const t = ctx.locale.bind(NS);

			// Definitions fold session events into the systemView target. The pure
			// inspectors come from the uiConversation service: client bundles cannot
			// value-import another plugin's module.
			ctx.uiConversation.events.register(systemMessageDefinition());
			ctx.uiConversation.events.register(requestHeaderDefinition(
				(previous, event, system) => ctx.uiConversation.inspectRequestPrompt(previous, event, system)));
			ctx.uiConversation.events.register(requestContextDefinition());

			// The target's snapshot builder.
			ctx.uiConversation.views.register({
				target: TARGET,
				create: () => createSystemViewBuilder(),
			});

			// Standard hook: the tab component receives useSystemView(selector).
			// Session paging state stays on the built-in source: re-providing the
			// built-in `session` hook would collide with uiSession's own entry.
			ctx.uiSession.provide({
				hooks: [TARGET],
				resolve: (binding) => {
					const target = ctx.uiConversation.binding(binding).target(TARGET);
					return {
						hooks: {
							[TARGET]: {
								getSnapshot: () => target.getSnapshot() ?? EMPTY_SNAPSHOT,
								subscribe: (listener) => target.subscribe(listener),
							},
						},
					};
				},
			});

			// The tab itself, beside chat (order 0) and trajectory (order 10).
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "system",
				order: 20,
				locale: NS,
				label: () => t("view.system"),
				inject: (sessionId) => {
					// Degrade instead of throwing: a view must never blank the tab
					// because history paging could not be wired.
					try {
						const session = ctx.sessions?.binding?.(sessionId)?.session;
						return {
							loadOlder: async () => {
								if (session === undefined) return false;
								try {
									const target = ctx.uiConversation.binding(sessionId).target(TARGET);
									const before = target.getSnapshot();
									await session.loadOlder();
									return target.getSnapshot() !== before;
								} catch {
									return false;
								}
							},
						};
					} catch {
						return {};
					}
				},
			}, SystemView));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});
