// antd warns "Instance created by useForm is not connected to any Form element"
// when a form instance is read or written before any <Form> has rendered it.
// The workspace form lives at App level but its <Form> (LocalRepoForm) only
// mounts inside the workspace view, so calls are held back until it first
// mounts and then flushed. After that, writes always go through: on a
// remount the store wins over initialValues, so it must stay current.

export function nextFormConnection(connection, mounted) {
	return { mounted, everMounted: Boolean(connection?.everMounted || mounted) };
}

export function shouldWriteToForm(connection) {
	return Boolean(connection?.everMounted);
}

// Before the first mount, values are kept in a pending map so reads still see
// earlier writes (as the unhooked store did); flush() hands them to the form.
export function guardFormWrites(form, getConnection) {
	let pending = {};
	const allowed = () => shouldWriteToForm(getConnection());
	return {
		setFieldsValue: (values) => {
			if (allowed()) form.setFieldsValue(values);
			else pending = { ...pending, ...values };
		},
		setFieldValue: (name, value) => {
			if (allowed()) form.setFieldValue(name, value);
			else pending = { ...pending, [name]: value };
		},
		getFieldValue: (name) =>
			allowed() ? form.getFieldValue(name) : pending[name],
		flush: () => {
			if (Object.keys(pending).length > 0) form.setFieldsValue(pending);
			pending = {};
		},
	};
}
