namespace Task2.CitiesViewer;

internal static class ConnectionSettings
{
    public const string Server = @"(localdb)\MSSQLLocalDB";
    public const string Database = "ZAKHAROV-LAB1";

    // TrustServerCertificate: LocalDB uses a self-signed certificate and the client encrypts by default.
    // Connect Timeout=30: the first connection may start the LocalDB instance.
    // ConnectRetryCount=0: otherwise a missing database (error 4060) is retried after 10 s.
    public const string ConnectionString =
        $"Server={Server};Database={Database};Integrated Security=true;TrustServerCertificate=true;Connect Timeout=30;ConnectRetryCount=0";
}
