using System.Security;

namespace Task3.RegistryViewer;

internal partial class MainForm : Form
{
    private readonly LabRegistry _registry;

    public MainForm(LabRegistry registry)
    {
        InitializeComponent();
        _registry = registry;
        keyLabel.Text = $"Key: {registry.Location}";
    }

    private void ShowP5Button_Click(object? sender, EventArgs e) => ShowValue(LabValues.P5);

    private void CreateP6Button_Click(object? sender, EventArgs e)
    {
        try
        {
            _registry.WriteMultiString(LabValues.P6, LabValues.P6Lines(DateTime.Now));
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or SecurityException)
        {
            statusLabel.Text = "P6 not created: administrator rights needed.";
            MessageBox.Show(this, $"Run the program as administrator to write to {_registry.Location}.", "Cannot create P6",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        // Read back what is really stored instead of showing what we meant to write
        ShowValue(LabValues.P6);
    }

    private void ShowValue(string name)
    {
        var value = _registry.ReadMultiString(name);

        valueLabel.Text = $"{name} (REG_MULTI_SZ):";
        linesList.Items.Clear();
        linesList.Items.AddRange(value.Lines);
        statusLabel.Text = LabValues.Explain(value, name, _registry.Location);

        if (value.State != ValueState.Ok)
        {
            MessageBox.Show(this, statusLabel.Text, $"Cannot read {name}", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
