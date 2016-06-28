import React from 'react';
import Oy from 'oy-vey';
import TeamInvite from 'universal/modules/email/containers/TeamInvite/TeamInvite';

export default function emailSSR(req, res) {
  const html = Oy.renderTemplate(<TeamInvite />, {
    title: 'Welcome to Action by Parabol',
    previewText: 'Welcome to Action by Parabol'
  });

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(html);
}
