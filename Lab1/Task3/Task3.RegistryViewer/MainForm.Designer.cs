namespace Task3.RegistryViewer;

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
        keyLabel = new Label();
        showP5Button = new Button();
        createP6Button = new Button();
        valueLabel = new Label();
        linesList = new ListBox();
        statusStrip = new StatusStrip();
        statusLabel = new ToolStripStatusLabel();
        statusStrip.SuspendLayout();
        SuspendLayout();
        //
        // keyLabel
        //
        keyLabel.AutoSize = true;
        keyLabel.Location = new Point(12, 12);
        keyLabel.Name = "keyLabel";
        keyLabel.Size = new Size(29, 15);
        keyLabel.TabIndex = 0;
        keyLabel.Text = "Key:";
        //
        // showP5Button
        //
        showP5Button.Location = new Point(12, 38);
        showP5Button.Name = "showP5Button";
        showP5Button.Size = new Size(140, 32);
        showP5Button.TabIndex = 1;
        showP5Button.Text = "Show P5";
        showP5Button.UseVisualStyleBackColor = true;
        showP5Button.Click += ShowP5Button_Click;
        //
        // createP6Button
        //
        createP6Button.Location = new Point(162, 38);
        createP6Button.Name = "createP6Button";
        createP6Button.Size = new Size(140, 32);
        createP6Button.TabIndex = 2;
        createP6Button.Text = "Create P6";
        createP6Button.UseVisualStyleBackColor = true;
        createP6Button.Click += CreateP6Button_Click;
        //
        // valueLabel
        //
        valueLabel.AutoSize = true;
        valueLabel.Location = new Point(12, 82);
        valueLabel.Name = "valueLabel";
        valueLabel.Size = new Size(0, 15);
        valueLabel.TabIndex = 3;
        //
        // linesList
        //
        linesList.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        linesList.FormattingEnabled = true;
        linesList.IntegralHeight = false;
        linesList.Location = new Point(12, 102);
        linesList.Name = "linesList";
        linesList.Size = new Size(480, 200);
        linesList.TabIndex = 4;
        //
        // statusStrip
        //
        statusStrip.Items.AddRange(new ToolStripItem[] { statusLabel });
        statusStrip.Location = new Point(0, 314);
        statusStrip.Name = "statusStrip";
        statusStrip.Size = new Size(504, 22);
        statusStrip.TabIndex = 5;
        //
        // statusLabel
        //
        statusLabel.Name = "statusLabel";
        statusLabel.Spring = true;
        statusLabel.TextAlign = ContentAlignment.MiddleLeft;
        //
        // MainForm
        //
        AutoScaleDimensions = new SizeF(7F, 15F);
        AutoScaleMode = AutoScaleMode.Font;
        ClientSize = new Size(504, 336);
        Controls.Add(keyLabel);
        Controls.Add(showP5Button);
        Controls.Add(createP6Button);
        Controls.Add(valueLabel);
        Controls.Add(linesList);
        Controls.Add(statusStrip);
        MinimumSize = new Size(420, 300);
        Name = "MainForm";
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Lab1 Task3 — Registry";
        statusStrip.ResumeLayout(false);
        statusStrip.PerformLayout();
        ResumeLayout(false);
        PerformLayout();
    }

    #endregion

    private Label keyLabel;
    private Button showP5Button;
    private Button createP6Button;
    private Label valueLabel;
    private ListBox linesList;
    private StatusStrip statusStrip;
    private ToolStripStatusLabel statusLabel;
}
