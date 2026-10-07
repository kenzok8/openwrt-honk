// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require view';
'require view.honk.rpc as honk';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return honk.status().then(function(status) {
			return { status: status };
		}).catch(function() {
			return { error: true };
		});
	},

	render: function(data) {
		honk.installStyles();
		const page = E('div', { 'class': 'cbi-map honk-page' });

		function renderInitialized(status) {
			const section = E('div', { 'class': 'honk-card' });
			const webUi = honk.localWebUi(status);

			section.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Dashboard')));

			if (webUi) {
				section.appendChild(E('a', {
					'class': 'cbi-button cbi-button-action',
					'href': webUi,
					'target': '_blank',
					'rel': 'noopener noreferrer'
				}, _('Open Dashboard')));
			}
			else if (!status.running) {
				section.appendChild(E('p', {}, _('Honk is stopped. Start it from the overview to open the dashboard.')));
				section.appendChild(E('a', {
					'class': 'cbi-button cbi-button-action',
					'href': L.url('admin/services/honk/overview')
				}, _('Go to overview')));
			}
			else {
				section.appendChild(E('p', {}, _('The dashboard is not ready yet. Check the overview for status.')));
				section.appendChild(E('a', {
					'class': 'cbi-button cbi-button-action',
					'href': L.url('admin/services/honk/overview')
				}, _('Go to overview')));
			}

			page.appendChild(section);
		}

		if (data.error) {
			page.appendChild(E('div', { 'class': 'alert-message' }, _('Could not read Honk status.')));
			return page;
		}

		if (data.status.initialized === true) {
			renderInitialized(data.status);
			return page;
		}

		const form = E('form', { 'class': 'honk-card' });
		const message = E('p', { 'role': 'status' }, '');
		const submit = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Initialize Honk'));

		form.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Initial setup')));
		form.appendChild(E('p', {}, _('Initialize Honk to write its default configuration and prepare the management dashboard.')));
		form.appendChild(E('div', { 'class': 'cbi-page-actions' }, submit));
		form.appendChild(message);
		form.addEventListener('submit', function(ev) {
			ev.preventDefault();
			submit.disabled = true;
			message.textContent = _('Initializing…');
			honk.initialize().then(honk.ensureOk).then(function(result) {
				message.textContent = honk.resultMessage(result, _('Honk initialized.'));
				form.remove();
				page.appendChild(E('p', { 'role': 'status' }, _('Refreshing status…')));
				return honk.status().then(function(status) {
					while (page.firstChild)
						page.removeChild(page.firstChild);
					renderInitialized(status);
				}).catch(function() {
					while (page.firstChild)
						page.removeChild(page.firstChild);
					page.appendChild(E('div', { 'class': 'alert-message' }, _('Could not read Honk status.')));
				});
			}).catch(function() {
				message.textContent = _('Initialization failed. Check the system status.');
			}).finally(function() {
				submit.disabled = false;
			});
		});

		page.appendChild(form);
		return page;
	}
});
