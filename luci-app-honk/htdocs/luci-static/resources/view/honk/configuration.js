// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require rpc';
'require view';
'require view.honk.rpc as honk';
'require view.honk.converter as converter';

const DAE_LIMIT = 2 * 1024 * 1024;
const PASTE_LIMIT = 2 * 1024 * 1024;

function utf8Length(value) {
	return new TextEncoder().encode(value).length;
}

function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
	}
	catch (e) {
		return false;
	}
}

function loadYamlParser() {
	if (window.jsyaml && window.jsyaml.load)
		return Promise.resolve(window.jsyaml);

	return new Promise(function(resolve, reject) {
		const script = document.createElement('script');
		script.src = L.resource('view/honk/vendor/js-yaml.min.js');
		script.onload = function() {
			if (window.jsyaml && window.jsyaml.load)
				resolve(window.jsyaml);
			else
				reject(new Error(_('YAML parser failed to load')));
		};
		script.onerror = function() { reject(new Error(_('YAML parser failed to load'))); };
		document.head.appendChild(script);
	});
}

function parsePasted(content) {
	let text = String(content || '').trim();
	if (!text)
		return Promise.resolve({ links: [], rejected: 1 });

	if (!converter.looksLikeNodeList(text)) {
		const decoded = converter.tryBase64Decode(text);
		if (decoded && (converter.looksLikeNodeList(decoded) ||
			converter.looksLikeClashYaml(decoded) || converter.looksLikeSurge(decoded)))
			text = decoded;
	}

	if (converter.looksLikeMihomoJson(text))
		return Promise.resolve(converter.parseMihomoJson(text));

	if (converter.looksLikeClashYaml(text)) {
		return loadYamlParser().then(function(yaml) {
			const doc = yaml.load(text);
			const proxies = (doc && doc.proxies) || [];
			const links = [];
			let rejected = 0;
			proxies.forEach(function(node) {
				if (converter.isMetadataProxy(node)) {
					rejected++;
					return;
				}
				const result = converter.convertProxy(node);
				if (result.ok) links.push(result.link);
				else rejected++;
			});
			return { links: links, rejected: rejected };
		});
	}

	if (converter.looksLikeSurge(text))
		return Promise.resolve(converter.parseSurgeProxies(text));

	return Promise.resolve(converter.parseUriList(text));
}


return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		honk.installStyles();

		const page = E('div', { 'class': 'cbi-map honk-page' });
		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Configuration')),
			E('p', { 'class': 'honk-header-sub' }, _('Honk reads its nodes, subscriptions and routing from /etc/honk/config.dae.'))
		]));

		const modeText = E('span', {}, '');
		const modeNote = E('p', { 'class': 'honk-note honk-mode-note' }, [ modeText ]);
		page.appendChild(modeNote);

		/* --- Add subscription --- */
		const subStatus = E('p', { 'class': 'honk-note', 'role': 'status', 'aria-live': 'polite' }, '');
		const nameInput = E('input', {
			'class': 'cbi-input-text', 'name': 'sub_name',
			'placeholder': _('Name, e.g. MyAirport'), 'maxlength': '256'
		});
		const urlInput = E('input', {
			'class': 'cbi-input-text', 'name': 'sub_url',
			'placeholder': 'https://…', 'inputmode': 'url'
		});
		const subBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, [ _('Add subscription') ]);

		subBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			const name = nameInput.value.trim();
			const url = urlInput.value.trim();
			if (!name) { subStatus.textContent = _('Name is required.'); nameInput.focus(); return; }
			if (!isHttpUrl(url)) { subStatus.textContent = _('A valid HTTP or HTTPS URL is required.'); urlInput.focus(); return; }
			subBtn.disabled = true;
			subStatus.textContent = _('Adding subscription…');
			honk.addSubscription(name, url).then(honk.ensureOk).then(function(result) {
				subStatus.textContent = honk.resultMessage(result, _('Subscription saved with usable nodes.'));
				nameInput.value = '';
				urlInput.value = '';
			}).catch(function(error) {
				subStatus.textContent = honk.errorMessage(error, _('Could not add the subscription.'));
			}).finally(function() { subBtn.disabled = false; });
		});

		const subModeHint = E('p', { 'class': 'honk-note honk-mode-hint' }, _('Manual mode: this tool is disabled until you restore managed mode (link at the top).'));
		subModeHint.hidden = true;
		const subSection = E('section', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('Add subscription')),
			E('p', { 'class': 'honk-note' }, _('Enter a name and subscription URL. Honk checks for usable nodes before saving.')),
			subModeHint,
			E('div', { 'class': 'honk-subscription-add' }, [ nameInput, urlInput, subBtn ]),
			subStatus
		]);

		/* --- Paste nodes --- */
		const pasteStatus = E('p', { 'class': 'honk-note', 'role': 'status', 'aria-live': 'polite' }, '');
		const pasteInput = E('textarea', {
			'class': 'cbi-input-textarea', 'name': 'paste',
			'rows': '10', 'spellcheck': 'false',
			'placeholder': _('Paste Clash YAML, Surge INI, Base64 or share links.')
		});
		const pasteBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, [ _('Import nodes') ]);

		pasteBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			const content = pasteInput.value.trim();
			if (!content) { pasteStatus.textContent = _('Paste nodes or subscription content first.'); pasteInput.focus(); return; }
			if (utf8Length(content) > PASTE_LIMIT) { pasteStatus.textContent = _('The pasted content is too large.'); return; }
			pasteBtn.disabled = true;
			pasteStatus.textContent = _('Parsing nodes…');
			parsePasted(content).then(function(parsed) {
				const links = (parsed && parsed.links) || [];
				if (!links.length) {
					pasteStatus.textContent = _('No nodes could be parsed from the input.');
					return;
				}
				pasteStatus.textContent = _('Importing %d node(s)…').format(links.length);
				return honk.addNodes(links.join('\n')).then(honk.ensureOk).then(function(result) {
					pasteStatus.textContent = honk.resultMessage(result, _('%d node(s) imported.').format(links.length));
					pasteInput.value = '';
				});
			}).catch(function(error) {
				pasteStatus.textContent = honk.errorMessage(error, _('Could not import nodes.'));
			}).finally(function() { pasteBtn.disabled = false; });
		});

		const pasteModeHint = E('p', { 'class': 'honk-note honk-mode-hint' }, _('Manual mode: this tool is disabled until you restore managed mode (link at the top).'));
		pasteModeHint.hidden = true;
		const pasteSection = E('section', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('Paste nodes')),
			E('p', { 'class': 'honk-note' }, _('Paste Clash YAML, Surge INI, Base64 or share links; they are parsed locally into nodes and written to /etc/honk/config.dae.')),
			pasteModeHint,
			pasteInput,
			E('div', { 'class': 'honk-actions' }, [ pasteBtn ]),
			pasteStatus
		]);

		/* --- Import a complete configuration and start Honk with it --- */
		const importStatus = E('p', { 'class': 'honk-note', 'role': 'status', 'aria-live': 'polite' }, '');
		const fileInput = E('input', { 'type': 'file', 'name': 'dae', 'accept': '.dae,text/plain' });
		const importBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, [ _('Import and start') ]);

		const importSection = E('section', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('Import a configuration')),
			E('p', { 'class': 'honk-note' }, _('Upload a complete dae file (subscriptions, nodes and routing included) and Honk starts with it: the file is validated, written to /etc/honk/config.dae and the service is restarted. To hand-edit or paste instead, use the editor below.')),
			E('div', { 'class': 'honk-subscription-add' }, [ fileInput, importBtn ]),
			importStatus
		]);

		/* --- Direct configuration --- */
		const editorStatus = E('p', { 'class': 'honk-note', 'role': 'status', 'aria-live': 'polite' }, '');
		const editor = E('textarea', {
			'class': 'cbi-input-textarea honk-config-editor', 'rows': '26',
			'spellcheck': 'false', 'wrap': 'off', 'aria-label': _('Full dae configuration')
		});
		const saveBtn = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'button' }, [ _('Save and apply') ]);
		const reloadBtn = E('button', { 'class': 'cbi-button', 'type': 'button' }, [ _('Reload from disk') ]);
		const validateBtn = E('button', { 'class': 'cbi-button cbi-button-link', 'type': 'button' }, [ _('Check configuration') ]);
		const managedBtn = E('a', { 'href': '#', 'class': 'honk-inline-link', 'role': 'button' }, [ _('Restore managed mode') ]);
		managedBtn.hidden = true;
		modeNote.appendChild(managedBtn);

		let editorBaseline = '';

		function setEditorContent(content, message) {
			editor.value = content || '';
			editorBaseline = editor.value;
			editorStatus.textContent = message || '';
		}

		function confirmEditorReplace() {
			return editor.value === editorBaseline || confirm(_('Discard the unsaved editor changes?'));
		}

		function isOk(result) {
			return !!result && (result.ok === true || result.ok === 1);
		}

		/* Validation result -> one readable line. Valid configs also report the
		   runtime facts the core derived from the file, which is what users
		   actually want to confirm before touching a live router. */
		function validationText(result) {
			if (isOk(result)) {
				const runtime = result.runtime || {};
				const facts = [];
				if (Array.isArray(runtime.lan_interfaces) && runtime.lan_interfaces.length)
					facts.push(_('LAN %s').format(runtime.lan_interfaces.join(', ')));
				if (runtime.native_api_enabled)
					facts.push(_('Doona %s').format(runtime.native_api_listen || '—'));
				if (runtime.clash_api_listen)
					facts.push(_('Clash API %s').format(runtime.clash_api_listen));
				return facts.length
					? _('Configuration is valid: %s').format(facts.join(' · '))
					: _('Configuration is valid.');
			}
			const diagnostics = Array.isArray(result && result.diagnostics) ? result.diagnostics : [];
			if (!diagnostics.length)
				return honk.resultMessage(result, _('Configuration validation failed.'));
			return diagnostics.map(function(item) {
				const line = Number.isInteger(item.line) ? _('Line %d').format(item.line) : '';
				const setting = item.setting ? String(item.setting) : String(item.code || '');
				const message = String(item.message || '');
				return [ line, setting, message ].filter(Boolean).join(' · ');
			}).join(' | ');
		}

		/* 本机事实：LuCI 的 Doona 端口、活跃 L3 设备。取一次复用。 */
		let runtimeFacts = null;
		function runtimeContext() {
			if (!runtimeFacts)
				runtimeFacts = Promise.all([
					honk.status().catch(function() { return {}; }),
					honk.lanCandidates().catch(function() { return {}; })
				]).then(function(results) {
					const status = results[0] || {};
					const candidates = (results[1] && results[1].candidates) || [];
					return {
						listenPort: String(status.listen_port || 9527),
						devices: candidates.map(function(item) { return item.l3_device; })
					};
				});
			return runtimeFacts;
		}

		/* 本机适配计划：算出「要改哪几处」和「改完的文本」，但**不落盘**。
		   改的是编辑器里的同一份配置，用户看得见、可以再手动调。 */
		function planAdaptations(text) {
			return runtimeContext().then(function(ctx) {
				const notes = [];
				let next = text;

				if (/^[ \t]*ui[ \t]*:[ \t]*['"]?embedded/m.test(next)) {
					next = next.replace(/^([ \t]*ui[ \t]*:).*$/m, "$1 '/usr/share/doona'");
					notes.push('ui: embedded → /usr/share/doona');
				}

				const lan = /^([ \t]*)lan_interface[ \t]*:[ \t]*([^\n#]+)(.*)$/m.exec(next);
				if (lan && ctx.devices.length) {
					const named = lan[2].split(',').map(function(item) {
						return item.trim().replace(/^['"]|['"]$/g, '');
					}).filter(Boolean);
					if (named.length && !named.some(function(name) { return ctx.devices.indexOf(name) >= 0; })) {
						next = next.replace(lan[0], lan[1] + "lan_interface: '" + ctx.devices[0] + "'" + (lan[3] || ''));
						notes.push('lan_interface: ' + named.join(',') + ' → ' + ctx.devices[0]);
					}
				}

				return { notes: notes, text: next };
			});
		}

		/* 保存前把适配写进编辑器。返回 false 表示用户拒绝，调用方应中止。 */
		function adaptEditor() {
			return planAdaptations(editor.value).then(function(plan) {
				if (!plan.notes.length)
					return true;
				if (!confirm(_('This configuration needs fixes for this router:') + '\n\n' + plan.notes.join('\n') + '\n\n' + _('Apply them in the editor now?')))
					return false;
				editor.value = plan.text;
				editor.dispatchEvent(new Event('input'));
				editorStatus.textContent = _('Adapted in the editor: %s').format(plan.notes.join('; '));
				return true;
			});
		}

		function withNotes(text) {
			return planAdaptations(editor.value).then(function(plan) {
				if (!plan.notes.length)
					return text;
				return text + ' ' + _('Saving will adapt for this router: %s').format(plan.notes.join(', '));
			});
		}

		function reportValidation(result, target) {
			return withNotes(validationText(result)).then(function(text) {
				target.textContent = text;
			});
		}

		function pollStatus() {
			return honk.status().catch(function() { return null; });
		}

		/* Validate -> confirm -> write -> start, shared by the file import and the
		   editor. `target` is the status line the caller wants the outcome in. */
		function applyContent(content, target) {
			target.textContent = _('Checking the configuration…');
			return honk.configValidate(content).then(function(result) {
				if (!isOk(result)) {
					target.textContent = validationText(result);
					return;
				}
				return Promise.resolve().then(function() {
					const question = _('Write this configuration to /etc/honk/config.dae and start Honk? The previous file is restored if startup fails.');
					if (!confirm(question))
						return;
					return commitContent(content, target);
				});
			}).catch(function(error) {
				target.textContent = honk.errorMessage(error, _('Configuration validation failed.'));
			});
		}

		function commitContent(content, target) {
			const previousTimeout = L.env.rpctimeout;
			L.env.rpctimeout = 180;
			target.textContent = _('Writing the configuration…');
			return honk.configSave(content).then(function(result) {
				if (!isOk(result)) {
					target.textContent = validationText(result);
					return;
				}
				if (content === editor.value)
					editorBaseline = editor.value;
				target.textContent = _('Starting Honk…');
				return honk.configApply().then(honk.ensureOk).then(function(applied) {
					target.textContent = honk.resultMessage(applied, _('Configuration applied.'));
					return pollStatus().then(function(status) {
						if (status && status.running)
							target.textContent = _('Configuration applied and Honk is running.');
						else
							target.textContent = _('Configuration was written, but Honk is not running: %s').format(
								((status && status.errors) || []).map(honk.statusIssue).join('; ') || _('unknown reason'));
					});
				}).catch(function(error) {
					target.textContent = honk.errorMessage(error, _('Could not apply the configuration.'));
				});
			}).catch(function(error) {
				target.textContent = honk.errorMessage(error, _('Could not save the configuration.'));
			}).then(function() {
				/* A failed apply rolls the file back, so reload what is really on
				   disk — but keep the outcome message the user needs to read. */
				const outcome = target.textContent;
				return refreshMode().then(function() {
					return loadCurrent(outcome === editorStatus.textContent ? outcome : '', true).catch(function() {});
				});
			}).finally(function() {
				L.env.rpctimeout = previousTimeout;
			});
		}

		function refreshMode() {
			return honk.status().then(function(status) {
				const manual = !!status && status.config_mode === 'manual';
				managedBtn.hidden = !manual;
				subModeHint.hidden = !manual;
				pasteModeHint.hidden = !manual;
				subBtn.disabled = manual;
				pasteBtn.disabled = manual;
				nameInput.disabled = manual;
				urlInput.disabled = manual;
				pasteInput.disabled = manual;
				modeText.textContent = manual
					? _('Manual mode: the file below owns nodes, groups, routing and DNS.')
					: _('Managed mode: the subscription and paste-nodes tools are active. Saving here switches Honk to manual mode.');
				return status;
			}).catch(function() {
				modeText.textContent = '';
			});
		}

		/* force = false 用于页面初次载入：如果用户已经抢先开始输入，不要用磁盘内容
		   把他的编辑冲掉（异步回填比手速快）。apply 之后要的是磁盘真身，用 force。 */
		function loadCurrent(message, force) {
			return honk.configRead().then(honk.ensureOk).then(function(result) {
				if (!force && editor.value !== editorBaseline && editor.value !== '')
					return result;
				setEditorContent(result.content || '', message || _('Current configuration loaded from /etc/honk/config.dae.'));
				return result;
			});
		}

		importBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			const file = fileInput.files && fileInput.files[0];
			if (!file) { importStatus.textContent = _('Choose a .dae file first.'); return; }
			if (file.size > DAE_LIMIT) { importStatus.textContent = _('The dae file exceeds the 2 MiB limit.'); return; }
			importBtn.disabled = true;
			importStatus.textContent = _('Reading %s…').format(file.name);
			file.text().then(function(content) {
				if (!String(content || '').trim())
					throw new Error(_('The file is empty.'));
				fileInput.value = '';
				setEditorContent(content, _('Loaded %s into the editor.').format(file.name));
				return planAdaptations(content).then(function(plan) {
					if (plan.notes.length) {
						if (!confirm(_('This configuration needs fixes for this router:') + '\n\n' + plan.notes.join('\n') + '\n\n' + _('Apply them in the editor now?')))
							return null;
						setEditorContent(plan.text, _('Adapted in the editor: %s').format(plan.notes.join('; ')));
					}
					return applyContent(editor.value, importStatus).then(function() {
						if (importStatus.textContent === _('Configuration applied and Honk is running.'))
							importStatus.textContent = _('%s imported and Honk is running.').format(file.name);
					});
				});
			}).catch(function(error) {
				importStatus.textContent = honk.errorMessage(error, _('Could not read the configuration file.'));
			}).finally(function() { importBtn.disabled = false; });
		});

		reloadBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirmEditorReplace()) return;
			reloadBtn.disabled = true;
			loadCurrent(null, true).catch(function(error) {
				editorStatus.textContent = honk.errorMessage(error, _('Could not read the saved configuration.'));
			}).finally(function() { reloadBtn.disabled = false; });
		});

		validateBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!editor.value.trim()) { editorStatus.textContent = _('The editor is empty.'); return; }
			validateBtn.disabled = true;
			editorStatus.textContent = _('Checking the configuration…');
			honk.configValidate(editor.value).then(function(result) {
				return reportValidation(result, editorStatus);
			}).catch(function(error) {
				editorStatus.textContent = honk.errorMessage(error, _('Configuration validation failed.'));
			}).finally(function() { validateBtn.disabled = false; });
		});

		saveBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!editor.value.trim()) { editorStatus.textContent = _('The editor is empty.'); return; }
			saveBtn.disabled = true;
			adaptEditor().then(function(proceed) {
				if (!proceed) { editorStatus.textContent = _('Save cancelled.'); return null; }
				return applyContent(editor.value, editorStatus);
			}).finally(function() { saveBtn.disabled = false; });
		});

		managedBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('Restore the managed configuration and return to the subscription tools? Honk restarts if it is running.'))) return;
			managedBtn.disabled = true;
			editorStatus.textContent = _('Restoring the managed configuration…');
			honk.configUseManaged().then(honk.ensureOk).then(function(result) {
				editorStatus.textContent = honk.resultMessage(result, _('Managed mode restored.'));
				return refreshMode().then(function() { return loadCurrent(null, true); });
			}).catch(function(error) {
				editorStatus.textContent = honk.errorMessage(error, _('Could not restore managed mode.'));
			}).finally(function() { managedBtn.disabled = false; });
		});

		const editorSection = E('section', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('Direct configuration')),
			E('p', { 'class': 'honk-note' }, _('Edit or paste a complete dae file. Check configuration only parses the text; Save and apply writes /etc/honk/config.dae, restarts Honk, and rolls back if startup fails.')),
			E('div', { 'class': 'honk-subscription-add' }, [ saveBtn, reloadBtn, validateBtn ]),
			editor,
			editorStatus
		]);

		loadCurrent().catch(function(error) {
			editorStatus.textContent = honk.errorMessage(error, _('Could not read the saved configuration.'));
		});
		refreshMode();

		page.appendChild(subSection);
		page.appendChild(pasteSection);
		page.appendChild(importSection);
		page.appendChild(editorSection);
		return page;
	}
});
