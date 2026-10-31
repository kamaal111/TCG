# DigitalOcean PostgreSQL and daily currency collection

[Back to server README](../README.md)

This guide connects a Mac directly to a DigitalOcean Managed PostgreSQL database,
applies the repository's migrations, and installs daily currency collection on
that Mac. The database allows only explicitly trusted sources. No SSH tunnel is
needed for this setup; SSH keys do not control direct PostgreSQL connections.

Run repository commands from the root of a permanent TCG checkout on the Mac
that will run the job. Do not install from a temporary feature worktree: the job
pins the checkout path and Node executable, which must remain available.
Node, pnpm, and just must be installed; see [development setup](../../docs/development.md).

## 1. Allow the Mac to connect

On the Mac that will run collection, open Terminal and run:

```sh
curl -4 https://api.ipify.org
```

The printed address is the Mac's public outbound IPv4 address, not its local
Wi-Fi address. In the DigitalOcean control panel:

1. Open **Databases**, then select the PostgreSQL cluster.
2. Find **Trusted Sources** under **Settings** or **Network Access**.
3. Keep the application Droplet entry and add the address printed above. If the
   field requires CIDR notation, append `/32` to allow only that IPv4 address.
4. Save the changes.

Do not add a rule for all addresses. Removing every trusted source makes the
database publicly accessible again. If the Mac's public IP changes, update its
entry. A VPN can also change the outbound IP; check from the network connection
the scheduled job will use. Other machines sharing that public IP are covered
by the same firewall entry, though database credentials are still required.

The application Droplet can use the private database hostname when it is in the
same VPC. This Mac must use the **public hostname** for a direct connection.
Choosing a private hostname does not itself disable access to the public endpoint.

## 2. Download the database certificate

For a Standard Edition cluster, open its **Overview → Connection Details** and
click **Download CA certificate**. If the downloaded file is named
`ca-certificate.crt`, copy it to a persistent location:

```sh
mkdir -p "$HOME/.config/tcg"
cp "$HOME/Downloads/ca-certificate.crt" "$HOME/.config/tcg/ca-certificate.crt"
echo "$HOME/.config/tcg/ca-certificate.crt"
```

If the browser used a different filename, use that filename in the `cp` command.
Keep the full path printed by `echo` for the next step.

Advanced Edition clusters use publicly trusted certificates and do not provide a
CA download; use `sslmode=verify-full` without `sslrootcert` for this Node client.

## 3. Save the connection configuration

In **Connection Details**, select **Public network**, the intended database and
user, and the **Connection string** format. Use the direct database connection,
rather than a connection pool, for migrations. Enable **verify-full** and copy
the URL, including its password.

Create a private file outside the repository:

```sh
mkdir -p "$HOME/.config/tcg"
touch "$HOME/.config/tcg/currencies.env"
chmod 600 "$HOME/.config/tcg/currencies.env"
nano "$HOME/.config/tcg/currencies.env"
```

Add the copied URL as a quoted value:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@PUBLIC_HOST:PORT/DATABASE?sslmode=verify-full&sslrootcert=ABSOLUTE_CA_FILE_PATH"
```

Keep the actual user, password, hostname, port, and database from DigitalOcean.
For Standard Edition, replace `ABSOLUTE_CA_FILE_PATH` with the full path printed
in step 2. If the copied URL has `sslmode=require`, replace it with
`sslmode=verify-full` and append `&sslrootcert=` followed by the certificate path.
URL-encode spaces in a certificate path as `%20`.

Use a literal absolute certificate path inside this URL: `$HOME` and `~` are not
expanded by the environment-file loader. For Advanced Edition, omit the
`&sslrootcert=...` parameter.

Only `DATABASE_URL` is required by the collector. `BETTER_AUTH_URL` is not needed.
Omit `DEBUG`; even `DEBUG=false` enables the current boolean parser, and the
schedule installer rejects it.

In nano, press **Control+O**, **Enter**, then **Control+X** to save and exit.
Keep this file private and outside version control.

## 4. Apply migrations

The migration recipe accepts an optional URL:

```sh
just migrate 'postgresql://USER:PASSWORD@PUBLIC_HOST:PORT/DATABASE?sslmode=verify-full&sslrootcert=ABSOLUTE_CA_FILE_PATH'
```

Replace the example with the complete configured URL and keep it quoted so the
shell does not interpret `&` or other special characters. An explicit argument
overrides `DATABASE_URL`; `just migrate` without an argument uses the existing
environment or repository `.env` configuration and local defaults.

To use the private file instead, without putting credentials in shell history:

```sh
env -u DATABASE_URL just --dotenv-path "$HOME/.config/tcg/currencies.env" migrate
```

This installs workspace dependencies and applies pending migrations. Continue
only after it prints `Database migrations completed.`

If migration fails with `SELF_SIGNED_CERT_IN_CHAIN`, check that `sslrootcert`
points to this cluster's downloaded CA certificate. Changing `sslmode=require`
to `sslmode=verify-full` removes the driver's SSL-mode warning, but the CA file
is still needed for Standard Edition. Keep certificate verification enabled.

## 5. Fetch initial rates and install the daily job

After 17:15 Amsterdam/Berlin time, collect initial rates using the same private
configuration file the scheduled job will use, from the repository root:

```sh
just --dotenv-path "$HOME/.config/tcg/currencies.env" fetch-daily-currencies
```

An already exported shell variable takes precedence over the environment file.
If your shell exports a different `DATABASE_URL`, run `unset DATABASE_URL` first.

A successful fetch
marks collection complete for the UTC day; an early fetch can retain yesterday's
published rates and suppress another fetch that afternoon.

Set the Mac's timezone to **Europe/Amsterdam** or **Europe/Berlin** in macOS
Date & Time settings. Check the timezone Node sees with:

```sh
node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone'
```

Preview, install, and inspect the job:

```sh
bash scripts/currency-schedule.sh preview "$HOME/.config/tcg/currencies.env"
just install-currency-schedule "$HOME/.config/tcg/currencies.env"
just currency-schedule-status
```

Run as your regular user. When `sudo` prompts during installation, enter your Mac
account password; Terminal does not display characters while you type it.

The installer creates a system **launchd** job for **17:15 Mac local time daily**.
It does not fetch immediately, apply migrations, or configure database access.
Reinstalling updates the same job. The Mac needs network access and must be
available to run collection; failures retry at the next daily trigger.

Read collection output and errors with:

```sh
tail -n 50 "$HOME/Library/Logs/TCG/currencies.stdout.log"
tail -n 50 "$HOME/Library/Logs/TCG/currencies.stderr.log"
```

See [scheduler operation](../README.md#schedule-collection-on-a-macos-home-server)
for sleep, reboot, log maintenance, Node upgrades, and uninstall behavior.

## DigitalOcean references

- [Connect to PostgreSQL clusters](https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/)
- [Restrict connections with trusted sources](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/)
