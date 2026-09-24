using System.ComponentModel;
using System.Diagnostics;
using System.Security;
using System.Security.Principal;

namespace Task3.RegistryViewer;

internal partial class MainForm : Form
{
    private readonly LabRegistry _registry;
    private readonly string[] _args;

    public MainForm(LabRegistry registry, string[] args)
    {
        InitializeComponent();
        _registry = registry;
        _args = args;
        keyLabel.Text = $"Key: {registry.Location}";
        if (IsElevated())
        {
            Text += " (Administrator)";
        }
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
            OfferRestartAsAdministrator();
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

    private void OfferRestartAsAdministrator()
    {
        if (IsElevated())
        {
            statusLabel.Text = $"Access to {_registry.Location} denied even for an administrator.";
            MessageBox.Show(this, statusLabel.Text, "Cannot create P6", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var answer = MessageBox.Show(this,
            $"Writing to {_registry.Location} requires administrator rights.\n\nRestart the program as administrator?",
            "Administrator rights needed", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes)
        {
            statusLabel.Text = "P6 not created: administrator rights needed.";
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
            {
                UseShellExecute = true,
                Verb = "runas",
                Arguments = string.Join(' ', _args.Select(arg => arg.Contains(' ') ? $"\"{arg}\"" : arg)),
            });
            Close();
        }
        catch (Win32Exception)
        {
            // The UAC prompt was declined
            statusLabel.Text = "Restart as administrator was cancelled.";
        }
    }

    private static bool IsElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }
}
