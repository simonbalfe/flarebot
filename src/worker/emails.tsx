import { Body, Container, Head, Heading, Html, Img, Preview, render, Section, Text } from "@react-email/components";

const fontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";

const styles = {
  body: { backgroundColor: "#f4f4f2", fontFamily, margin: 0, padding: "48px 16px" },
  card: { backgroundColor: "#ffffff", borderRadius: "28px", maxWidth: "400px", margin: "0 auto", padding: "40px 32px" },
  logo: { display: "block", margin: "0 auto 20px" },
  heading: { color: "#0a0a0a", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.3px", lineHeight: "28px", margin: "0 0 28px", textAlign: "center" },
  action: { textAlign: "center" },
  code: { backgroundColor: "#f4f4f2", borderRadius: "16px", color: "#0a0a0a", fontFamily: "'SF Mono', Menlo, Consolas, monospace", fontSize: "32px", fontWeight: 600, letterSpacing: "10px", lineHeight: "40px", margin: 0, padding: "14px 0 14px 10px", textAlign: "center" },
  caption: { color: "#8a8a86", fontSize: "12px", lineHeight: "16px", margin: "24px 0 0", textAlign: "center" },
} as const;

interface SignInEmailProps {
  code: string;
  logoUrl: string;
  expiresInMinutes: number;
}

function SignInEmail({ code, logoUrl, expiresInMinutes }: SignInEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your flarebot code is ${code}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.card}>
          <Img src={logoUrl} alt="flarebot" width="64" style={styles.logo} />
          <Heading as="h1" style={styles.heading}>Your flarebot code</Heading>
          <Section style={styles.action}>
            <Text style={styles.code}>{code}</Text>
          </Section>
          <Text style={styles.caption}>Expires in {expiresInMinutes} minutes</Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderSignInEmail(props: SignInEmailProps): Promise<{ html: string; text: string }> {
  const element = <SignInEmail {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
