using Microsoft.Data.SqlClient;

namespace Task2.CitiesViewer;

internal partial class MainForm : Form
{
    private readonly CitiesRepository _repository;

    public MainForm(CitiesRepository repository)
    {
        InitializeComponent();
        _repository = repository;
        sourceLabel.Text = $"{ConnectionSettings.Server} / {ConnectionSettings.Database}";
    }

    private async void MainForm_Load(object? sender, EventArgs e) => await LoadCitiesAsync();

    private async void RefreshButton_Click(object? sender, EventArgs e) => await LoadCitiesAsync();

    private async Task LoadCitiesAsync()
    {
        refreshButton.Enabled = false;
        statusLabel.Text = "Loading…";
        try
        {
            var cities = await _repository.GetAllAsync(CancellationToken.None);
            citiesBindingSource.DataSource = cities;
            statusLabel.Text = $"Rows: {cities.Count}";
        }
        catch (SqlException ex)
        {
            citiesBindingSource.DataSource = Array.Empty<City>();
            statusLabel.Text = $"SQL error {ex.Number}";
            MessageBox.Show(this, ErrorMessages.ForSqlError(ex.Number, ex.Message), "Cannot load cities",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            refreshButton.Enabled = true;
        }
    }
}
