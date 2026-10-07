// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require rpc';
'require view';
'require view.honk.rpc as honk';
'require view.honk.sha256 as sha256Fallback';
'require view.honk.converter as converter';

const DAE_UPLOAD_PATH = '/tmp/honk-v2-upload/import.dae';
const DAE_LIMIT = 2 * 1024 * 1024;
const SHARE_LINK_LIMIT = 1 * 1024 * 1024;
const PASTE_LIMIT = 2 * 1024 * 1024;

function utf8Length(value) {
	return new TextEncoder().encode(value).length;
}

function sha256(file) {
	return file.arrayBuffer().then(function(buffer) {
		if (!window.crypto || !window.crypto.subtle)
			return sha256Fallback.sha256(buffer);

		return window.crypto.subtle.digest('SHA-256', buffer).then(function(hash) {
			return Array.from(new Uint8Array(hash)).map(function(byte) {
				return byte.toString(16).padStart(2, '0');
			}).join('');
		});
	});
}

function uploadDae(file) {
	const form = new FormData();
	form.append('sessionid', rpc.getSessionID());
	form.append('filename', DAE_UPLOAD_PATH);
	form.append('filedata', file, file.name);
	return fetch(L.env.cgi_base + '/cgi-upload', {
		method: 'POST',
		credentials: 'same-origin',
		body: form
	}).then(function(response) {
		return response.json();
	}).then(function(result) {
		if (!result || result.failure)
			throw new Error('upload_failed');
		return result;
	});
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

function field(label, input, help) {
	const row = E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': input.id }, label),
		E('div', { 'class': 'cbi-value-field' }, input)
	]);
	if (help)
		row.appendChild(E('div', { 'class': 'cbi-value-description honk-note' }, help));
	return row;
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
		const capabilityMessage = E('p', { 'class': 'honk-note', 'role': 'status' }, _('Checking import support…'));
		const previewMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status', 'aria-live': 'polite' }, '');
		const previewDetails = E('section', { 'class': 'honk-card', 'aria-live': 'polite' });
		const inputs = [];
		const actionButtons = [];
		let previewBusy = false;
		let recoveryBlocked = false;
		let previewSupported = false;
		let applySupported = false;
		let activePreview = null;
		let previewGeneration = 0;

		const applyButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'type': 'button',
			'disabled': true
		}, _('Apply this preview'));

		function setBusy(busy) {
			previewBusy = busy;
			inputs.forEach(function(input) { input.disabled = busy || recoveryBlocked; });
			actionButtons.forEach(function(button) { button.disabled = busy || recoveryBlocked || !previewSupported; });
			applyButton.disabled = busy || recoveryBlocked || !applySupported || !activePreview;
		}

		function invalidatePreview() {
			previewGeneration++;
			if (!activePreview)
				return;

			activePreview = null;
			previewDetails.replaceChildren();
			applyButton.disabled = true;
			previewMessage.textContent = _('Inputs changed. Create a new preview before applying.');
		}

		function showPreview(result) {
			activePreview = result;
			previewDetails.replaceChildren();
			const replacements = Array.isArray(result.replaced_sections) ? result.replaced_sections.map(function(item) {
				return Array.isArray(item) ? '%s: %d'.format(item[0], item[1]) : '';
			}).filter(Boolean).join(', ') : '';
			const imported = Array.isArray(result.imported_sections) ? result.imported_sections.join(', ') : '';
			const excluded = Array.isArray(result.excluded_sections) ? result.excluded_sections.join(', ') : '';

			previewDetails.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Preview summary')));
			previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Candidate: %d nodes, %d subscriptions, %d files changed.').format(
				Number(result.node_count) || 0, Number(result.subscription_count) || 0, Number(result.changed_files) || 0)));
			if (imported)
				previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Imported sections: %s').format(imported)));
			if (excluded)
				previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Excluded sections: %s').format(excluded)));
			if (replacements)
				previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Existing sections replaced: %s').format(replacements)));
			previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Parser and configuration checks passed. Runtime validation: %s.').format(
				result.mock && result.mock.state === 'passed' ? _('passed') : _('not run'))));

			if (result.mock && ((Array.isArray(result.mock.executed) && result.mock.executed.length) ||
				(Array.isArray(result.mock.skipped) && result.mock.skipped.length))) {
				const diagnostics = E('details', {}, [
					E('summary', {}, _('Validation details'))
				]);
				if (Array.isArray(result.mock.executed) && result.mock.executed.length)
					diagnostics.appendChild(E('p', { 'class': 'honk-note' }, _('Executed checks: %s').format(result.mock.executed.join(', '))));
				if (Array.isArray(result.mock.skipped) && result.mock.skipped.length)
					diagnostics.appendChild(E('p', { 'class': 'honk-note' }, _('Skipped checks: %s').format(result.mock.skipped.join(', '))));
				previewDetails.appendChild(diagnostics);
			}

			if (applySupported) {
				previewDetails.appendChild(E('div', { 'class': 'honk-actions' }, applyButton));
				applyButton.disabled = recoveryBlocked || previewBusy;
			}
			else {
				previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Applying a preview is not available in this installed core.')));
			}
			previewDetails.appendChild(E('p', { 'class': 'honk-note' }, _('Imported items are not assigned to groups automatically.')));
		}

		function preview(request) {
			if (previewBusy || !previewSupported)
				return;

			const generation = ++previewGeneration;
			activePreview = null;
			setBusy(true);
			previewMessage.textContent = _('Preparing preview…');
			previewDetails.replaceChildren();
			honk.importPreview(request).then(honk.ensureOk).then(function(job) {
				return honk.waitJob(job.job_id, function(status) {
					previewMessage.textContent = honk.jobPhaseMessage(status.phase);
				}).then(honk.ensureOk);
			}).then(function(result) {
				if (generation !== previewGeneration) {
					previewMessage.textContent = _('Inputs changed. Create a new preview before applying.');
					return;
				}
				showPreview(result);
				previewMessage.textContent = _('Preview is ready. No configuration has been applied.');
			}).catch(function(error) {
				previewMessage.textContent = honk.errorMessage(error, _('Preview failed.'));
			}).finally(function() {
				setBusy(false);
			});
		}

		applyButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (previewBusy || !applySupported || !activePreview)
				return;
			if (!window.confirm(_('Apply the reviewed preview? Any running Honk service will be stopped during the change and its previous running state will be restored afterward.')))
				return;

			setBusy(true);
			previewMessage.textContent = _('Starting configuration apply…');
			honk.importApply(activePreview).then(honk.ensureOk).then(function(job) {
				return honk.waitJob(job.job_id, function(status) {
					previewMessage.textContent = honk.jobPhaseMessage(status.phase);
				}).then(honk.ensureOk);
			}).then(function() {
				activePreview = null;
				previewDetails.replaceChildren();
				previewMessage.textContent = _('Configuration applied. Review group assignment and update subscriptions in Doona.');
			}).catch(function(error) {
				previewMessage.textContent = honk.errorMessage(error, _('Configuration apply failed.'));
				if (error && error.recoveryRequired)
					recoveryBlocked = true;
			}).finally(function() {
				setBusy(false);
			});
		});

		const subscriptionPanel = E('form', { 'class': 'honk-card', 'id': 'honk-panel-subscription', 'role': 'tabpanel', 'tabindex': '0' });
		const subscriptionName = E('input', {
			'class': 'cbi-input-text', 'type': 'text', 'id': 'honk-subscription-name', 'name': 'name',
			'maxlength': '256', 'autocomplete': 'off', 'required': true
		});
		const subscriptionUrl = E('input', {
			'class': 'cbi-input-text', 'type': 'url', 'id': 'honk-subscription-url', 'name': 'url',
			'maxlength': '8192', 'autocomplete': 'url', 'required': true
		});
		const subscriptionButton = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'submit' }, _('Preview subscription'));
		inputs.push(subscriptionName, subscriptionUrl);
		actionButtons.push(subscriptionButton);
		subscriptionPanel.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Add subscription')));
		subscriptionPanel.appendChild(field(_('Name'), subscriptionName));
		subscriptionPanel.appendChild(field(_('Subscription URL'), subscriptionUrl, _('Use an HTTP or HTTPS subscription address.')));
		subscriptionPanel.appendChild(E('div', { 'class': 'honk-actions' }, subscriptionButton));
		subscriptionPanel.addEventListener('submit', function(ev) {
			ev.preventDefault();
			if (previewBusy || recoveryBlocked || !previewSupported)
				return;
			const name = subscriptionName.value.trim();
			const url = subscriptionUrl.value.trim();
			if (!subscriptionPanel.reportValidity())
				return;
			if (!name) {
				subscriptionName.setCustomValidity(_('Enter a subscription name.'));
				subscriptionName.reportValidity();
				return;
			}
			if (!isHttpUrl(url)) {
				subscriptionUrl.setCustomValidity(_('Enter a valid HTTP or HTTPS URL.'));
				subscriptionUrl.reportValidity();
				return;
			}
			preview({ action: 'preview', kind: 'subscription', name: name, url: url });
		});
		subscriptionUrl.addEventListener('input', function() { subscriptionUrl.setCustomValidity(''); invalidatePreview(); });
		subscriptionName.addEventListener('input', function() { subscriptionName.setCustomValidity(''); invalidatePreview(); });

		const linksPanel = E('form', { 'class': 'honk-card', 'id': 'honk-panel-links', 'role': 'tabpanel', 'tabindex': '0', 'hidden': true });
		const linksInput = E('textarea', {
			'class': 'cbi-input-textarea', 'id': 'honk-share-links', 'name': 'share_links',
			'rows': '10', 'maxlength': String(PASTE_LIMIT), 'spellcheck': 'false', 'required': true
		});
		const linksButton = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'submit' }, _('Import nodes'));
		inputs.push(linksInput);
		actionButtons.push(linksButton);
		linksPanel.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Paste nodes')));
		linksPanel.appendChild(E('label', { 'class': 'cbi-value-title', 'for': linksInput.id }, _('Clash YAML, Surge INI, Base64 or share links')));
		linksPanel.appendChild(linksInput);
		linksPanel.appendChild(E('p', { 'class': 'honk-note' }, _('Paste subscription content or share links; they are parsed locally into nodes. A parsed request is limited to 1 MiB.')));
		linksPanel.appendChild(E('div', { 'class': 'honk-actions' }, linksButton));
		linksPanel.addEventListener('submit', function(ev) {
			ev.preventDefault();
			if (previewBusy || recoveryBlocked || !previewSupported)
				return;
			if (!linksPanel.reportValidity())
				return;
			if (!linksInput.value.trim()) {
				linksInput.setCustomValidity(_('Paste subscription content or share links.'));
				linksInput.reportValidity();
				return;
			}
			if (utf8Length(linksInput.value) > PASTE_LIMIT) {
				previewMessage.textContent = _('The pasted content is too large. Paste a smaller selection.');
				return;
			}
			if (!applySupported) {
				previewMessage.textContent = _('Applying a preview is not available in this installed core.');
				return;
			}
			if (!window.confirm(_('Import the pasted nodes? Any running Honk service will be stopped during the change and its previous running state will be restored afterward.')))
				return;

			setBusy(true);
			previewMessage.textContent = _('Parsing pasted content…');
			parsePasted(linksInput.value).then(function(parsed) {
				if (!parsed.links.length) {
					previewMessage.textContent = _('No importable nodes were found in the pasted content.');
					return;
				}
				const uris = parsed.links.join('\n');
				if (utf8Length(uris) > SHARE_LINK_LIMIT) {
					previewMessage.textContent = _('Parsed nodes exceed the 1 MiB per request limit. Paste them in smaller batches.');
					return;
				}
				previewMessage.textContent = _('Preparing import…');
				return honk.importPreview({ action: 'preview', kind: 'share_links', share_links: uris }).then(honk.ensureOk).then(function(job) {
					return honk.waitJob(job.job_id, function(status) {
						previewMessage.textContent = honk.jobPhaseMessage(status.phase);
					}).then(honk.ensureOk);
				}).then(function(preview) {
					const count = Number(preview.node_count) || parsed.links.length;
					previewMessage.textContent = _('Applying %d imported nodes…').format(count);
					return honk.importApply(preview).then(honk.ensureOk).then(function(job) {
						return honk.waitJob(job.job_id, function(status) {
							previewMessage.textContent = honk.jobPhaseMessage(status.phase);
						}).then(honk.ensureOk);
					}).then(function() { return count; });
				}).then(function(count) {
					previewDetails.replaceChildren();
					previewMessage.textContent = _('Imported %d nodes.').format(count);
				});
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					recoveryBlocked = true;
				previewMessage.textContent = honk.errorMessage(error, _('Import failed.'));
			}).finally(function() {
				setBusy(false);
			});
		});
		linksInput.addEventListener('input', function() { linksInput.setCustomValidity(''); invalidatePreview(); });

		const daePanel = E('form', { 'class': 'honk-card', 'id': 'honk-panel-dae', 'role': 'tabpanel', 'tabindex': '0', 'hidden': true });
		const daeFile = E('input', { 'type': 'file', 'id': 'honk-dae-file', 'name': 'dae_file', 'accept': '.dae,text/plain', 'required': true });
		const daeButton = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'submit' }, _('Preview dae file'));
		inputs.push(daeFile);
		actionButtons.push(daeButton);
		daePanel.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Import dae business configuration')));
		daePanel.appendChild(field(_('Configuration file'), daeFile, _('Choose one .dae file up to 2 MiB.')));
		daePanel.appendChild(E('p', { 'class': 'honk-note' }, _('This replaces the business sections listed in the preview. Global settings are excluded, and external includes are rejected.')));
		daePanel.appendChild(E('div', { 'class': 'honk-actions' }, daeButton));
		daePanel.addEventListener('submit', function(ev) {
			ev.preventDefault();
			if (previewBusy || recoveryBlocked || !previewSupported)
				return;
			if (!daePanel.reportValidity())
				return;
			const file = daeFile.files && daeFile.files[0];
			if (!file) {
				daeFile.reportValidity();
				return;
			}
			if (file.size > DAE_LIMIT) {
				previewMessage.textContent = _('The dae file exceeds the 2 MiB limit.');
				return;
			}
			const generation = ++previewGeneration;
			setBusy(true);
			previewMessage.textContent = _('Checking file and calculating SHA-256…');
			sha256(file).then(function(hash) {
				return honk.importUploadPrepare().then(honk.ensureOk).then(function() {
					previewMessage.textContent = _('Uploading the selected dae file…');
					return uploadDae(file).then(function() { return hash; });
				});
			}).then(function(hash) {
				setBusy(false);
				if (generation !== previewGeneration)
					return;
				preview({ action: 'preview', kind: 'dae', mode: 'replace', upload_sha256: hash });
			}).catch(function(error) {
				setBusy(false);
				previewMessage.textContent = honk.errorMessage(error, _('File upload failed.'));
			});
		});
		daeFile.addEventListener('change', invalidatePreview);

		const tabList = E('div', { 'class': 'honk-seg', 'role': 'tablist', 'aria-label': _('Configuration input type') });
		const panels = {
			subscription: subscriptionPanel,
			links: linksPanel,
			dae: daePanel
		};
		const tabs = [];
		[
			{ id: 'subscription', panel: subscriptionPanel, label: _('Add subscription') },
			{ id: 'links', panel: linksPanel, label: _('Paste nodes') },
			{ id: 'dae', panel: daePanel, label: _('Import configuration') }
		].forEach(function(entry, index, entries) {
			const tab = E('button', {
				'class': 'honk-seg-btn',
				'type': 'button',
				'role': 'tab',
				'id': 'honk-tab-%s'.format(entry.id),
				'aria-controls': entry.panel.id,
				'aria-selected': index === 0 ? 'true' : 'false',
				'tabindex': index === 0 ? '0' : '-1'
			}, entry.label);
			entry.panel.setAttribute('aria-labelledby', tab.id);
			tab.addEventListener('click', function() { selectTab(entry.id); });
			tab.addEventListener('keydown', function(ev) {
				if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')
					return;
				ev.preventDefault();
				const delta = ev.key === 'ArrowRight' ? 1 : -1;
				const nextIndex = (index + delta + entries.length) % entries.length;
				selectTab(entries[nextIndex].id);
				tabs[nextIndex].focus();
			});
			tabs.push(tab);
			tabList.appendChild(tab);
		});

		function selectTab(id) {
			tabs.forEach(function(tab, index) {
				const selected = tab.id === 'honk-tab-%s'.format(id);
				tab.setAttribute('aria-selected', selected ? 'true' : 'false');
				tab.setAttribute('tabindex', selected ? '0' : '-1');
				panels[['subscription', 'links', 'dae'][index]].hidden = !selected;
			});
		}

		const safetyNotes = E('div', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('About this import')),
			E('p', { 'class': 'honk-note' }, _('Subscriptions and nodes append without changing routing, DNS, or service state. Dae import replaces business sections shown in the preview; global settings stay excluded.')),
			E('details', {}, [
				E('summary', {}, _('Before applying')),
				E('p', { 'class': 'honk-note' }, _('Imported items are not assigned to groups automatically. Review group assignment and subscription updates in Doona.')),
				E('p', { 'class': 'honk-note' }, _('Save any Doona browser draft before applying configuration changes.'))
			])
		]);

		setBusy(false);
		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Configuration')),
			E('p', { 'class': 'honk-header-sub' }, _('Add subscriptions, nodes or import a dae business configuration with a preview and transactional apply.'))
		]));
		page.appendChild(capabilityMessage);
		page.appendChild(safetyNotes);
		page.appendChild(tabList);
		page.appendChild(subscriptionPanel);
		page.appendChild(linksPanel);
		page.appendChild(daePanel);
		page.appendChild(previewMessage);
		page.appendChild(previewDetails);

		honk.importCapabilities().then(honk.ensureOk).then(function(result) {
			previewSupported = result.import_preview === true;
			applySupported = result.import_apply === true;
			capabilityMessage.textContent = previewSupported ?
				(applySupported ? _('This core supports preview and transactional apply.') : _('Preview is available. Apply stays disabled until transactional import is supported by this core.')) :
				_('Import is unavailable in this installed core. Existing service controls remain available.');
			setBusy(false);
		}).catch(function() {
			previewSupported = false;
			capabilityMessage.textContent = _('Import is unavailable in this installed core. Existing service controls remain available.');
			setBusy(false);
		});

		return page;
	}
});
