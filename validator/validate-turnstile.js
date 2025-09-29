exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const body = new URLSearchParams(event.body);
  const turnstileToken = body.get('cf-turnstile-response');
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!turnstileToken) {
    console.error('No Turnstile token provided');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing Turnstile token' })
    };
  }

  try {
    const turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: turnstileToken,
        remoteip: event.headers['client-ip'] || event.headers['x-nf-client-connection-ip'] || 'unknown'
      }).toString()
    });

    const turnstileData = await turnstileResponse.json();
    console.log('Turnstile response:', turnstileData); // Log full response

    if (!turnstileData.success) {
      console.error('Turnstile verification failed:', turnstileData['error-codes']);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Turnstile verification failed', details: turnstileData['error-codes'] })
      };
    }

    // Forward to Netlify form handling
    const netlifyResponse = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: event.body
    });

    if (netlifyResponse.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    } else {
      console.error('Netlify form submission failed:', netlifyResponse.status);
      return {
        statusCode: netlifyResponse.status,
        body: JSON.stringify({ error: 'Failed to process form submission' })
      };
    }
  } catch (error) {
    console.error('Server error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message })
    };
  }
};