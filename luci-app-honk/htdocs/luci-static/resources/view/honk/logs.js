// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require view';
'require view.honk.rpc as honk';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
	_timer: null,

	handleUnload: function() {
		if (this._timer != null)
			clearInterval(this._timer);
		this._timer = null;
	},

	render: function() {
		const source = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'service' }, _('Service')),
			E('option', { 'value': 'core' }, _('Core')),
			E('option', { 'value': 'maintenance' }, _('Maintenance'))
		]);
		const level = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'all' }, _('All levels')),
			E('option', { 'value': 'debug' }, _('Debug and above')),
			E('option', { 'value': 'info' }, _('Info and above')),
			E('option', { 'value': 'warn' }, _('Warnings and errors')),
			E('option', { 'value': 'error' }, _('Errors only'))
		]);
		const output = E('pre', {
			'class': 'honk-log-output',
			'aria-live': 'polite',
			'style': 'max-width:100%; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere;'
		}, _('Loading logs…'));
		const status = E('p', { 'role': 'status' }, '');
		const pause = E('button', { 'class': 'cbi-button', 'type': 'button' }, _('Pause'));
		const refresh = E('button', { 'class': 'cbi-button', 'type': 'button' }, _('Refresh now'));
		const download = E('button', { 'class': 'cbi-button', 'type': 'button' }, _('Download redacted log'));
		let paused = false;
		let pendingRequests = 0;
		let requestSequence = 0;
		let latest = [];
		download.disabled = true;

		function loadLogs(force) {
			if (paused && !force || pendingRequests && !force)
				return Promise.resolve();

			const requestId = ++requestSequence;
			const requestedSource = source.value;
			const requestedLevel = level.value;
			pendingRequests++;
			download.disabled = true;
			return honk.logs(requestedSource, requestedLevel, 200).then(honk.ensureOk).then(function(result) {
				if (requestId !== requestSequence)
					return;
				latest = Array.isArray(result.lines) ? result.lines.map(String) : [];
				output.textContent = latest.length ? latest.join('\n') : _('No matching Honk log entries.');
				status.textContent = result.capped ? _('Output was capped; showing the latest %d entries.').format(latest.length) : _('Showing the latest %d matching entries.').format(latest.length);
			}).catch(function(error) {
				if (requestId === requestSequence)
					status.textContent = honk.errorMessage(error, _('Could not read Honk logs.'));
			}).finally(function() {
				pendingRequests--;
				download.disabled = pendingRequests > 0;
			});
		}

		pause.addEventListener('click', function(ev) {
			ev.preventDefault();
			paused = !paused;
			pause.textContent = paused ? _('Resume') : _('Pause');
			status.textContent = paused ? _('Log polling is paused.') : _('Log polling resumed.');
			if (!paused)
				loadLogs(true);
		});
		refresh.addEventListener('click', function(ev) {
			ev.preventDefault();
			loadLogs(true);
		});
		source.addEventListener('change', function() { loadLogs(true); });
		level.addEventListener('change', function() { loadLogs(true); });
		download.addEventListener('click', function(ev) {
			ev.preventDefault();
			const blob = new Blob([ latest.join('\n') + (latest.length ? '\n' : '') ], { type: 'text/plain;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const link = E('a', { 'href': url, 'download': 'honk-redacted.log' });
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
		});

		this._timer = setInterval(function() { loadLogs(false); }, 5000);
		loadLogs(true);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Logs')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, _('Shows up to 200 Honk-specific lines, capped at 32 KiB, and refreshes every 5 seconds while live. Sensitive URLs and credentials are redacted before display.')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('label', {}, [ _('Log source'), source ]),
					E('label', {}, [ _('Minimum level'), level ]),
					pause,
					refresh,
					download
				]),
				status,
				output
			])
		]);
	}
});
