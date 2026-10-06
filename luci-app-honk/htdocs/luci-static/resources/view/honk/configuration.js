// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require rpc';
'require view';
'require view.honk.rpc as honk';
'require view.honk.sha256 as sha256Fallback';

const DAE_UPLOAD_PATH = '/tmp/honk-v2-upload/import.dae';
const DAE_LIMIT = 2 * 1024 * 1024;
const SHARE_LINK_LIMIT = 16 * 1024;

function utf8Length(value) {
	return new TextEncoder().encode(value).length;
}

function sha256(file) {
	return file.arrayBuffer().then(function(buffer) {
		if (!window.crypto || !window.crypto.subtle)
			return sha256Fallback(buffer);

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

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		const page = E('div', { 'class': 'cbi-map' });
		const capabilityMessage = E('p', { 'role': 'status' }, _('Checking import support…'));
		const previewMessage = E('p', { 'role': 'status' }, '');
		const previewDetails = E('div', { 'class': 'cbi-section' });
		const controls = [];
		let previewBusy = false;
		let recoveryBlocked = false;
		let applySupported = false;
		let activePreview = null;

		function setBusy(busy) {
			previewBusy = busy;
			controls.forEach(function(control) { control.disabled = busy || recoveryBlocked; });
		}

		function showPreview(result) {
			activePreview = result;
			previewDetails.replaceChildren();
			const replacements = Array.isArray(result.replaced_sections) ? result.replaced_sections.map(function(item) {
				return Array.isArray(item) ? '%s: %d'.format(item[0], item[1]) : '';
			}).filter(Boolean).join(', ') : '';
			const imported = Array.isArray(result.imported_sections) ? result.imported_sections.join(', ') : '';
			const excluded = Array.isArray(result.excluded_sections) ? result.excluded_sections.join(', ') : '';
			previewDetails.appendChild(E('h3', {}, _('Preview summary')));
			previewDetails.appendChild(E('p', {}, _('Candidate: %d nodes, %d subscriptions, %d files changed.').format(
				Number(result.node_count) || 0, Number(result.subscription_count) || 0, Number(result.changed_files) || 0)));
			if (imported)
				previewDetails.appendChild(E('p', {}, _('Imported sections: %s').format(imported)));
			if (excluded)
				previewDetails.appendChild(E('p', {}, _('Excluded sections: %s').format(excluded)));
			if (replacements)
				previewDetails.appendChild(E('p', {}, _('Existing sections replaced: %s').format(replacements)));
			previewDetails.appendChild(E('p', {}, _('Parser and configuration checks passed. Runtime validation: %s.').format(
				result.mock && result.mock.state === 'passed' ? _('passed') : _('not run'))));
			if (result.mock && Array.isArray(result.mock.executed) && result.mock.executed.length)
				previewDetails.appendChild(E('p', {}, _('Executed checks: %s').format(result.mock.executed.join(', '))));
			if (result.mock && Array.isArray(result.mock.skipped) && result.mock.skipped.length)
				previewDetails.appendChild(E('p', {}, _('Skipped checks: %s').format(result.mock.skipped.join(', '))));
			if (!applySupported)
				previewDetails.appendChild(E('p', {}, _('Apply is disabled until this core reports transactional import support.')));
			else
				previewDetails.appendChild(applyButton);
			previewDetails.appendChild(E('p', {}, _('Imported items are not assigned to groups automatically.')));
		}

		function preview(request) {
			if (previewBusy)
				return;
			setBusy(true);
			previewMessage.textContent = _('Preparing preview…');
			previewDetails.replaceChildren();
			honk.importPreview(request).then(honk.ensureOk).then(function(job) {
				return honk.waitJob(job.job_id, function(status) {
					previewMessage.textContent = honk.jobPhaseMessage(status.phase);
				}).then(honk.ensureOk);
			}).then(function(result) {
				showPreview(result);
				previewMessage.textContent = _('Preview is ready. No configuration has been applied.');
			}).catch(function(error) {
				previewMessage.textContent = honk.errorMessage(error, _('Preview failed.'));
			}).finally(function() {
				setBusy(false);
			});
		}

		const applyButton = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button', 'disabled': 'disabled' }, _('Apply this preview'));
		controls.push(applyButton);
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
				if (error && error.recoveryRequired) {
					recoveryBlocked = true;
					controls.forEach(function(control) { control.disabled = true; });
				}
			}).finally(function() {
				setBusy(false);
			});
		});

		const subscriptionName = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'maxlength': '256', 'autocomplete': 'off' });
		const subscriptionUrl = E('input', { 'class': 'cbi-input-text', 'type': 'url', 'maxlength': '8192', 'autocomplete': 'off' });
		const subscriptionButton = E('button', { 'class': 'cbi-button', 'type': 'button', 'disabled': 'disabled' }, _('Preview subscription'));
		controls.push(subscriptionName, subscriptionUrl, subscriptionButton);
		subscriptionButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			preview({ action: 'preview', kind: 'subscription', name: subscriptionName.value, url: subscriptionUrl.value });
		});
		const subscription = E('fieldset', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Add subscription')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Name')), E('div', { 'class': 'cbi-value-field' }, subscriptionName) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Subscription URL')), E('div', { 'class': 'cbi-value-field' }, subscriptionUrl) ]),
			subscriptionButton
		]);

		const linksInput = E('textarea', { 'class': 'cbi-input-textarea', 'rows': '6', 'maxlength': String(SHARE_LINK_LIMIT), 'spellcheck': 'false' });
		const linksButton = E('button', { 'class': 'cbi-button', 'type': 'button', 'disabled': 'disabled' }, _('Preview share links'));
		controls.push(linksInput, linksButton);
		linksButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (utf8Length(linksInput.value) > SHARE_LINK_LIMIT) {
				previewMessage.textContent = _('Share links exceed the 16 KiB per request limit. Submit them in smaller batches.');
				return;
			}
			preview({ action: 'preview', kind: 'share_links', share_links: linksInput.value });
		});
		const shareLinks = E('fieldset', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Import share links')),
			E('p', {}, _('One link per line. A single request is limited to 16 KiB; larger lists can be submitted in batches. Conflicts are reported for review.')),
			linksInput,
			linksButton
		]);

		const daeFile = E('input', { 'type': 'file', 'accept': '.dae,text/plain' });
		const daeButton = E('button', { 'class': 'cbi-button', 'type': 'button', 'disabled': 'disabled' }, _('Preview dae file'));
		controls.push(daeFile, daeButton);
		daeButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			const file = daeFile.files && daeFile.files[0];
			if (!file) {
				previewMessage.textContent = _('Choose a dae file first.');
				return;
			}
			if (file.size > DAE_LIMIT) {
				previewMessage.textContent = _('The dae file exceeds the 2 MiB limit.');
				return;
			}
			setBusy(true);
			previewMessage.textContent = _('Checking file and calculating SHA-256…');
			sha256(file).then(function(hash) {
				return honk.importUploadPrepare().then(honk.ensureOk).then(function() {
					previewMessage.textContent = _('Uploading the selected dae file…');
					return uploadDae(file).then(function() { return hash; });
				});
			}).then(function(hash) {
				setBusy(false);
				preview({ action: 'preview', kind: 'dae', mode: 'replace', upload_sha256: hash });
			}).catch(function(error) {
				setBusy(false);
				previewMessage.textContent = honk.errorMessage(error, _('File upload failed.'));
			});
		});
		const dae = E('fieldset', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Import dae business configuration')),
			E('p', {}, _('One file up to 2 MiB. The browser calculates SHA-256 before upload; the core verifies the uploaded file again.')),
			daeFile,
			E('p', {}, _('Only nodes, subscriptions, groups, routing, and DNS sections can be previewed. Global settings and external includes are excluded or rejected.')),
			daeButton
		]);

		page.appendChild(E('h2', {}, _('Configuration')));
		page.appendChild(E('div', { 'class': 'alert-message' }, [
			E('p', {}, _('Imports append subscriptions and nodes by default. Dae import replaces only the listed business sections after preview.')),
			E('p', {}, _('Saving subscriptions and share links does not start Honk or change routing, DNS, or the enabled state. Dae import replaces business routing and DNS only as shown in the preview; it does not overwrite global or managed system settings.')),
			E('p', {}, _('Imported subscriptions and nodes are not assigned to groups automatically. Review group assignment and Doona update behavior after import.')),
			E('p', {}, _('Save any browser draft in Doona before applying configuration changes.')),
			E('p', {}, _('The preview is available when supported by the installed core. Apply remains disabled until a verified transactional apply is available.'))
		]));
		page.appendChild(capabilityMessage);
		page.appendChild(subscription);
		page.appendChild(shareLinks);
		page.appendChild(dae);
		page.appendChild(previewMessage);
		page.appendChild(previewDetails);

		honk.importCapabilities().then(honk.ensureOk).then(function(result) {
			if (result.import_preview) {
				applySupported = result.import_apply === true;
				capabilityMessage.textContent = result.import_apply ? _('This core supports preview and apply.') : _('This core supports preview; transactional apply is not installed yet.');
				controls.forEach(function(control) { control.disabled = false; });
			}
			else {
				capabilityMessage.textContent = _('Import is unavailable in this installed core. Existing service controls remain available.');
			}
		}).catch(function() {
			capabilityMessage.textContent = _('Import is unavailable in this installed core. Existing service controls remain available.');
		});

		return page;
	}
});
