/**
 * Wrap async Express handlers so rejections become next(err) (MentorMate-style safety).
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
