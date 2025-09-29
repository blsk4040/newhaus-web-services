exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const body = new URLSearchParams(event.body);
  const turnstileToken = body.get('cf-turnstile-response');
  const secretKey = process.env.TURNSTILE_SECRET_KEY; // Set in Netlify environment variables

  if (!turnstileToken) {
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
        response: turnstileToken
      }).toString()
    });

    const turnstileData = await turnstileResponse.json();

    if (!turnstileData.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Turnstile verification failed', details: turnstileData['error-codes'] })
      };
    }

    // Forward to Netlify's form handling
    const netlifyResponse = await fetch('/.netlify/functions/submissions', {
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
      return {
        statusCode: netlifyResponse.status,
        body: JSON.stringify({ error: 'Failed to process form submission' })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message })
    };
  }
};