namespace Task2.CitiesViewer;

partial class MainForm
{
    /// <summary>
    ///  Required designer variable.
    /// </summary>
    private System.ComponentModel.IContainer components = null;

    /// <summary>
    ///  Clean up any resources being used.
    /// </summary>
    /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
    protected override void Dispose(bool disposing)
    {
        if (disposing && (components != null))
        {
            components.Dispose();
        }
        base.Dispose(disposing);
    }

    #region Windows Form Designer generated code

    /// <summary>
    ///  Required method for Designer support - do not modify
    ///  the contents of this method with the code editor.
    /// </summary>
    private void InitializeComponent()
    {
        components = new System.ComponentModel.Container();
        citiesGrid = new DataGridView();
        idColumn = new DataGridViewTextBoxColumn();
        nameColumn = new DataGridViewTextBoxColumn();
        citiesBindingSource = new BindingSource(components);
        refreshButton = new Button();
        statusStrip = new StatusStrip();
        statusLabel = new ToolStripStatusLabel();
        sourceLabel = new ToolStripStatusLabel();
        ((System.ComponentModel.ISupportInitialize)citiesGrid).BeginInit();
        ((System.ComponentModel.ISupportInitialize)citiesBindingSource).BeginInit();
        statusStrip.SuspendLayout();
        SuspendLayout();
        //
        // citiesGrid
        //
        citiesGrid.AllowUserToAddRows = false;
        citiesGrid.AllowUserToDeleteRows = false;
        citiesGrid.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        citiesGrid.AutoGenerateColumns = false;
        citiesGrid.BackgroundColor = SystemColors.Window;
        citiesGrid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize;
        citiesGrid.Columns.AddRange(new DataGridViewColumn[] { idColumn, nameColumn });
        citiesGrid.DataSource = citiesBindingSource;
        citiesGrid.Location = new Point(12, 12);
        citiesGrid.MultiSelect = false;
        citiesGrid.Name = "citiesGrid";
        citiesGrid.ReadOnly = true;
        citiesGrid.RowHeadersVisible = false;
        citiesGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        citiesGrid.Size = new Size(460, 250);
        citiesGrid.TabIndex = 0;
        //
        // idColumn
        //
        idColumn.DataPropertyName = "Id";
        idColumn.HeaderText = "ID";
        idColumn.Name = "idColumn";
        idColumn.ReadOnly = true;
        idColumn.Width = 80;
        //
        // nameColumn
        //
        nameColumn.AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
        nameColumn.DataPropertyName = "Name";
        nameColumn.HeaderText = "Name";
        nameColumn.Name = "nameColumn";
        nameColumn.ReadOnly = true;
        //
        // refreshButton
        //
        refreshButton.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        refreshButton.Location = new Point(372, 272);
        refreshButton.Name = "refreshButton";
        refreshButton.Size = new Size(100, 30);
        refreshButton.TabIndex = 1;
        refreshButton.Text = "Refresh";
        refreshButton.UseVisualStyleBackColor = true;
        refreshButton.Click += RefreshButton_Click;
        //
        // statusStrip
        //
        statusStrip.Items.AddRange(new ToolStripItem[] { statusLabel, sourceLabel });
        statusStrip.Location = new Point(0, 314);
        statusStrip.Name = "statusStrip";
        statusStrip.Size = new Size(484, 22);
        statusStrip.TabIndex = 2;
        //
        // statusLabel
        //
        statusLabel.Name = "statusLabel";
        statusLabel.Spring = true;
        statusLabel.TextAlign = ContentAlignment.MiddleLeft;
        //
        // sourceLabel
        //
        sourceLabel.Name = "sourceLabel";
        //
        // MainForm
        //
        AutoScaleDimensions = new SizeF(7F, 15F);
        AutoScaleMode = AutoScaleMode.Font;
        ClientSize = new Size(484, 336);
        Controls.Add(citiesGrid);
        Controls.Add(refreshButton);
        Controls.Add(statusStrip);
        MinimumSize = new Size(400, 300);
        Name = "MainForm";
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Lab1 Task2 — My visited cities";
        Load += MainForm_Load;
        ((System.ComponentModel.ISupportInitialize)citiesGrid).EndInit();
        ((System.ComponentModel.ISupportInitialize)citiesBindingSource).EndInit();
        statusStrip.ResumeLayout(false);
        statusStrip.PerformLayout();
        ResumeLayout(false);
        PerformLayout();
    }

    #endregion

    private DataGridView citiesGrid;
    private DataGridViewTextBoxColumn idColumn;
    private DataGridViewTextBoxColumn nameColumn;
    private BindingSource citiesBindingSource;
    private Button refreshButton;
    private StatusStrip statusStrip;
    private ToolStripStatusLabel statusLabel;
    private ToolStripStatusLabel sourceLabel;
}
