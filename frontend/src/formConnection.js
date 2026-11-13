// antd warns "Instance created by useForm is not connected to any Form element"
// when a form instance is read or written before any <Form> has rendered it.
// The workspace form lives at App level but its <Form> (LocalRepoForm) only
// mounts inside the workspace view, so calls are skipped until it first mounts.
// Every skipped write is mirrored in React state, which feeds the Form's
// initialValues on first mount. After that, writes always go through: on a
// remount the store wins over initialValues, so it must stay current.

export function nextFormConnection(connection, mounted) {
	return { mounted, everMounted: Boolean(connection?.everMounted || mounted) };
}

export function shouldWriteToForm(connection) {
	return Boolean(connection?.everMounted);
}

export function guardFormWrites(form, getConnection) {
	const allowed = () => shouldWriteToForm(getConnection());
	return {
		setFieldsValue: (values) => {
			if (allowed()) form.setFieldsValue(values);
		},
		setFieldValue: (name, value) => {
			if (allowed()) form.setFieldValue(name, value);
		},
		getFieldValue: (name) => (allowed() ? form.getFieldValue(name) : undefined),
	};
}
