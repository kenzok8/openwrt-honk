// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require fs';
'require ui';
'require view';
'require view.honk.rpc as honk';

const BACKUP_PATH = '/tmp/honk-backup.tar.gz';
const RESTORE_PATH = '/tmp/honk-maintenance/restore.tar.gz';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		honk.installStyles();
		const page = E('div', { 'class': 'cbi-map honk-page' });
		const recoveryMessage = E('p', { 'class': 'alert-message', 'role': 'status' }, '');
		recoveryMessage.hidden = true;
		const writeControls = [];
		let recoveryRequired = false;

		function phaseMessage(job, fallback) {
			const messages = {
				checking_feed: _('Checking the signed update source…'),
				downloading: _('Downloading the signed package set…'),
				preparing: _('Preparing maintenance…'),
				stopping: _('Stopping Honk…'),
				applying: _('Applying the staged data…'),
				validating: _('Validating the new state…'),
				starting: _('Starting Honk…'),
				rolling_back: _('Restoring the previous state…'),
				committing: _('Finishing the transaction…'),
				recovery: _('Recovery is required before another write operation.')
			};
			return messages[job.phase] || fallback;
		}

		function blockWrites() {
			recoveryRequired = true;
			writeControls.forEach(function(button) { button.disabled = true; });
		}

		/* --- Honk updates card --- */
		const updateSection = E('section', { 'class': 'honk-card' });
		const updateMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, _('Check for updates first. Installation requires signature and rollback validation.'));
		const updateCheck = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button' }, _('Check for updates'));
		const updateApply = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'button' }, _('Install update'));
		let updateApplyAvailable = false;
		updateApply.disabled = true;
		writeControls.push(updateApply);

		updateCheck.addEventListener('click', function(ev) {
			ev.preventDefault();
			updateCheck.disabled = true;
			updateApplyAvailable = false;
			updateApply.disabled = true;
			updateMessage.textContent = _('Checking update source…');
			honk.updateCheck().then(honk.ensureOk).then(function(job) {
				return honk.waitJob(job.job_id, function(progress) {
					updateMessage.textContent = phaseMessage(progress, _('Checking the signed update source…'));
				});
			}).then(function(result) {
				if (result.available) {
					updateMessage.textContent = result.apply_enabled === true ? _('A compatible update is available: %s').format(result.version || '') : honk.statusIssue(result.reason);
					updateApplyAvailable = result.apply_enabled === true;
				} else {
					updateApplyAvailable = false;
					updateMessage.textContent = result.reason === 'trusted_feed_unavailable' ? _('No trusted update source is configured.') : _('No compatible update is available.');
				}
			}).catch(function(error) {
				updateApplyAvailable = false;
				updateMessage.textContent = honk.errorMessage(error, _('Update check failed.'));
			}).finally(function() {
				updateCheck.disabled = recoveryRequired;
				updateApply.disabled = recoveryRequired || !updateApplyAvailable;
			});
		});
		updateApply.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('Install the verified Honk, LuCI, Doona, and Chinese translation package set? If installation or startup fails, Honk will remain stopped and show recovery instructions.')))
				return;
			updateCheck.disabled = true;
			updateApplyAvailable = false;
			updateApply.disabled = true;
			updateMessage.textContent = _('Preparing the signed update…');
			honk.updateApply().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					updateMessage.textContent = phaseMessage(job, _('Installing the verified update…'));
				});
			}).then(function(result) {
				updateMessage.textContent = honk.resultMessage(result, _('Update installed.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				updateMessage.textContent = honk.errorMessage(error, _('Update failed.'));
			}).finally(function() {
				updateCheck.disabled = recoveryRequired;
				updateApply.disabled = true;
			});
		});

		updateSection.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Honk updates')));
		updateSection.appendChild(E('p', { 'class': 'honk-note' }, _('Updates install the matching Honk core, LuCI, Doona assets, and Chinese translation as one package set.')));
		updateSection.appendChild(E('p', { 'class': 'honk-note' }, _('This target supports x86_64 on OpenWrt 25.12 using APK packages.')));
		updateSection.appendChild(E('div', { 'class': 'honk-actions' }, [ updateCheck, updateApply ]));
		updateSection.appendChild(updateMessage);
		updateSection.appendChild(E('details', {}, [
			E('summary', {}, _('Update requirements')),
			E('p', { 'class': 'honk-note' }, _('The updater verifies a signed compatibility manifest. Installation remains unavailable until a complete verified rollback package set is available and the device transaction path has passed validation.'))
		]));

		/* --- Backup and restore card --- */
		const backupSection = E('section', { 'class': 'honk-card' });
		const backupMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const backup = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Download backup'));
		writeControls.push(backup);
		backup.addEventListener('click', function(ev) {
			ev.preventDefault();
			backup.disabled = true;
			backupMessage.textContent = _('Preparing backup…');
			honk.backup().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					backupMessage.textContent = job.state === 'running' ? _('Creating backup…') : _('Preparing download…');
				});
			}).then(function() {
				return fs.read_direct(BACKUP_PATH, 'blob');
			}).then(function(blob) {
				const url = URL.createObjectURL(blob);
				const link = E('a', { 'href': url, 'download': 'honk-backup.tar.gz' });
				document.body.appendChild(link);
				link.click();
				link.remove();
				setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
				backupMessage.textContent = _('Backup downloaded.');
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				backupMessage.textContent = honk.errorMessage(error, _('Backup failed.'));
			}).finally(function() { backup.disabled = recoveryRequired; });
		});
		const restore = E('button', { 'class': 'cbi-button cbi-button-negative' }, _('Restore backup'));
		writeControls.push(restore);
		restore.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('Stop Honk before restoring. Restoring replaces Honk user data. Continue?')))
				return;

			restore.disabled = true;
			backupMessage.textContent = _('Choose a backup archive to upload…');
			honk.restorePrepare().then(honk.ensureOk).then(function() {
				return ui.uploadFile(RESTORE_PATH);
			}).then(function() {
				backupMessage.textContent = _('Restoring…');
				return honk.restore();
			}).then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					backupMessage.textContent = phaseMessage(job, _('Restoring Honk data…'));
				});
			}).then(function(result) {
				backupMessage.textContent = honk.resultMessage(result, _('Backup restored.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				backupMessage.textContent = honk.errorMessage(error, _('Restore failed.'));
			}).finally(function() { restore.disabled = recoveryRequired; });
		});
		backupSection.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Backup and restore')));
		backupSection.appendChild(E('p', { 'class': 'honk-note' }, _('Create a backup archive or restore one from your computer.')));
		backupSection.appendChild(E('div', { 'class': 'honk-actions' }, [ backup, restore ]));
		backupSection.appendChild(backupMessage);

		/* --- System check and repair card --- */
		const health = E('section', { 'class': 'honk-card' });
		const healthMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const check = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Run system check'));
		check.addEventListener('click', function(ev) {
			ev.preventDefault();
			check.disabled = true;
			healthMessage.textContent = _('Checking…');
			honk.check().then(function(result) {
				if (result && result.ok === true) {
					healthMessage.textContent = _('System check passed.');
				}
				else if (Array.isArray(result && result.errors) && result.errors.length) {
					healthMessage.textContent = result.errors.map(honk.statusIssue).join('；');
				}
				else {
					healthMessage.textContent = _('The backend did not confirm the check.');
				}
			}).catch(function(error) {
				healthMessage.textContent = _('System check failed.');
			}).finally(function() { check.disabled = false; });
		});
		const repairMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const repair = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Repair'));
		writeControls.push(repair);
		repair.addEventListener('click', function(ev) {
			ev.preventDefault();
			repair.disabled = true;
			repairMessage.textContent = _('Repairing…');
			honk.repair().then(honk.ensureOk).then(function(result) {
				repairMessage.textContent = honk.resultMessage(result, _('Repair completed.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				repairMessage.textContent = honk.errorMessage(error, _('Repair failed.'));
			}).finally(function() { repair.disabled = recoveryRequired; });
		});
		health.appendChild(E('h3', { 'class': 'honk-card-title' }, _('System check and repair')));
		health.appendChild(E('p', { 'class': 'honk-note' }, _('Checks Honk system components and reports detected issues.')));
		health.appendChild(E('div', { 'class': 'honk-actions' }, [ check, repair ]));
		health.appendChild(healthMessage);
		health.appendChild(repairMessage);
		health.appendChild(E('p', { 'class': 'honk-note' }, _('Repair replaces missing or damaged Honk system files and does not overwrite user configuration.')));

		/* --- Reset card (danger zone) --- */
		const resetSection = E('section', { 'class': 'honk-card' });
		const resetMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const reset = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Reset Honk data'));
		writeControls.push(reset);
		reset.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('This permanently clears Honk subscriptions, nodes, policies, DNS data, history, and cache. The administrator account is kept, and Honk will be stopped. Continue?')))
				return;

			reset.disabled = true;
			resetMessage.textContent = _('Resetting Honk data…');
			honk.reset().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					resetMessage.textContent = phaseMessage(job, _('Resetting Honk data…'));
				});
			}).then(function(result) {
				resetMessage.textContent = honk.resultMessage(result, _('Honk data reset. The service is stopped.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				resetMessage.textContent = honk.errorMessage(error, _('Reset failed.'));
			}).finally(function() { reset.disabled = recoveryRequired; });
		});
		resetSection.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Reset Honk data')));
		resetSection.appendChild(E('p', { 'class': 'honk-note' }, _('Reset clears Honk subscriptions, nodes, policies, DNS data, history, and cache, then restores default configuration. It keeps the administrator account and leaves Honk stopped with boot disabled.')));
		resetSection.appendChild(E('div', { 'class': 'honk-actions' }, reset));
		resetSection.appendChild(resetMessage);

		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Maintenance')),
			E('p', { 'class': 'honk-header-sub' }, _('Updates, backups and system recovery for the Honk installation.'))
		]));
		page.appendChild(recoveryMessage);
		page.appendChild(updateSection);
		page.appendChild(backupSection);
		page.appendChild(health);
		page.appendChild(resetSection);

		honk.status().then(function(result) {
			const errors = Array.isArray(result && result.errors) ? result.errors : [];
			const recoveryToken = errors.indexOf('update_recovery_required') >= 0 ? 'update_recovery_required' :
				errors.indexOf('maintenance_recovery_required') >= 0 ? 'maintenance_recovery_required' : null;
			if (recoveryToken) {
				blockWrites();
				recoveryMessage.textContent = honk.statusIssue(recoveryToken);
				recoveryMessage.hidden = false;
			}
		}).catch(function() {});
		return page;
	}
});
